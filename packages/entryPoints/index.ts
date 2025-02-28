declare const globalThis: { DecentralandKernel: IDecentralandKernel }

import { sdk } from '@dcl/schemas'
import { createLogger } from 'shared/logger'
import { IDecentralandKernel, IEthereumProvider, KernelOptions, KernelResult, LoginState } from '@dcl/kernel-interface'
import { BringDownClientAndShowError, ErrorContext, ReportFatalError } from 'shared/loading/ReportFatalError'
import { renderingInBackground, renderingInForeground } from 'shared/loading/types'
import { worldToGrid } from '../atomicHelpers/parcelScenePositions'
import {
  DEBUG_WS_MESSAGES,
  ETHEREUM_NETWORK,
  getAssetBundlesBaseUrl,
  HAS_INITIAL_POSITION_MARK,
  OPEN_AVATAR_EDITOR
} from '../config/index'
import 'unity-interface/trace'
import { lastPlayerPosition, teleportObservable } from 'shared/world/positionThings'
import { getPreviewSceneId, loadPreviewScene, startUnitySceneWorkers } from '../unity-interface/dcl'
import { initializeUnity } from '../unity-interface/initializer'
import { HUDElementID, RenderProfile } from 'shared/types'
import { foregroundChangeObservable, isForeground } from 'shared/world/worldState'
import { getCurrentIdentity } from 'shared/session/selectors'
import { realmInitialized } from 'shared/dao'
import { ensureMetaConfigurationInitialized } from 'shared/meta'
import { WorldConfig } from 'shared/meta/types'
import { getFeatureFlagEnabled, getFeatureFlags, getWorldConfig } from 'shared/meta/selectors'
import { kernelConfigForRenderer } from '../unity-interface/kernelConfigForRenderer'
import { ensureUnityInterface } from 'shared/renderer'
import { globalObservable } from 'shared/observables'
import { initShared } from 'shared'
import { setResourcesURL } from 'shared/location'
import { WebSocketProvider } from 'eth-connect'
import { resolveUrlFromUrn } from '@dcl/urn-resolver'
import { store } from 'shared/store/isolatedStore'
import { onLoginCompleted } from 'shared/session/sagas'
import { authenticate, initSession } from 'shared/session/actions'
import { localProfilesRepo } from 'shared/profiles/sagas'
import { getStoredSession } from 'shared/session'
import { setPersistentStorage } from 'atomicHelpers/persistentStorage'
import { getCatalystServer, getFetchContentServer, getSelectedNetwork } from 'shared/dao/selectors'
import { clientDebug } from 'unity-interface/ClientDebug'
import { signalEngineReady } from 'shared/renderer/actions'
import { IUnityInterface } from 'unity-interface/IUnityInterface'
import { getCurrentUserProfile } from 'shared/profiles/selectors'

const logger = createLogger('kernel: ')

async function resolveBaseUrl(urn: string): Promise<string> {
  if (urn.startsWith('urn:')) {
    const t = await resolveUrlFromUrn(urn)
    if (t) {
      return (t + '/').replace(/(\/)+$/, '/')
    }
    throw new Error('Cannot resolve content for URN ' + urn)
  }
  return (urn + '/').replace(/(\/)+$/, '/')
}

function orFail(withError: string): never {
  throw new Error(withError)
}

function authenticateWhenItsReady(provider: IEthereumProvider, isGuest: boolean) {
  const loginState = store.getState().session.loginState

  if (loginState === LoginState.WAITING_PROVIDER) {
    store.dispatch(authenticate(provider, isGuest))
  } else {
    const unsubscribe = store.subscribe(() => {
      const loginState = store.getState().session.loginState
      if (loginState === LoginState.WAITING_PROVIDER) {
        unsubscribe()
        store.dispatch(authenticate(provider, isGuest))
      }
    })
  }
}

globalThis.DecentralandKernel = {
  async initKernel(options: KernelOptions): Promise<KernelResult> {
    options.kernelOptions.baseUrl = await resolveBaseUrl(
      options.kernelOptions.baseUrl || orFail('MISSING kernelOptions.baseUrl')
    )
    options.rendererOptions.baseUrl = await resolveBaseUrl(
      options.rendererOptions.baseUrl || orFail('MISSING rendererOptions.baseUrl')
    )

    if (options.kernelOptions.persistentStorage) {
      setPersistentStorage(options.kernelOptions.persistentStorage)
    }

    const { container } = options.rendererOptions
    const { baseUrl } = options.kernelOptions

    if (baseUrl) {
      setResourcesURL(baseUrl)
    }

    if (!container) throw new Error('cannot find element #gameContainer')

    // initShared must be called immediately, before return
    initShared()

    // initInternal must be called asynchronously, _after_ returning
    async function initInternal() {
      // Initializes the Session Saga
      store.dispatch(initSession())

      await initializeUnity(options.rendererOptions)
      await loadWebsiteSystems(options.kernelOptions)
    }

    setTimeout(
      () =>
        initInternal().catch((err) => {
          ReportFatalError(err, ErrorContext.WEBSITE_INIT)
          BringDownClientAndShowError(err.toString())
        }),
      0
    )

    return {
      authenticate(provider: any, isGuest: boolean) {
        if (!provider) {
          throw new Error('A provider must be provided')
        }
        if (typeof provider === 'string') {
          if (provider.startsWith('ws:') || provider.startsWith('wss:')) {
            provider = new WebSocketProvider(provider)
          } else {
            throw new Error('Text provider can only be WebSocket')
          }
        }
        authenticateWhenItsReady(provider, isGuest)
      },
      on: globalObservable.on.bind(globalObservable),
      version: 'mockedversion',
      // this method is used for auto-login
      async hasStoredSession(address: string, networkId: number) {
        if (!(await getStoredSession(address))) return { result: false }

        const profile = await localProfilesRepo.get(
          address,
          networkId === 1 ? ETHEREUM_NETWORK.MAINNET : ETHEREUM_NETWORK.ROPSTEN
        )

        return { result: !!profile, profile: profile || null } as any
      }
    }
  }
}

async function loadWebsiteSystems(options: KernelOptions['kernelOptions']) {
  const i = (await ensureUnityInterface()).unityInterface

  // NOTE(Brian): Scene download manager uses meta config to determine which empty parcels we want
  //              so ensuring meta configuration is initialized in this stage is a must
  // NOTE(Pablo): We also need meta configuration to know if we need to enable voice chat
  await ensureMetaConfigurationInitialized()

  //Note: This should be sent to unity before any other feature because some features may need a system init from FeatureFlag
  //      For example disable AssetBundles needs a system from FeatureFlag
  i.SetFeatureFlagsConfiguration(getFeatureFlags(store.getState()))

  const questEnabled = getFeatureFlagEnabled(store.getState(), 'quests')
  const worldConfig: WorldConfig | undefined = getWorldConfig(store.getState())
  const renderProfile = worldConfig ? worldConfig.renderProfile ?? RenderProfile.DEFAULT : RenderProfile.DEFAULT
  i.SetRenderProfile(renderProfile)

  // killswitch, disable asset bundles
  if (!getFeatureFlagEnabled(store.getState(), 'asset_bundles')) {
    i.SetDisableAssetBundles()
  }

  i.ConfigureHUDElement(HUDElementID.MINIMAP, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.NOTIFICATION, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.AVATAR_EDITOR, { active: true, visible: OPEN_AVATAR_EDITOR })
  i.ConfigureHUDElement(HUDElementID.SIGNUP, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.LOADING_HUD, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.AVATAR_NAMES, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.SETTINGS_PANEL, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.EXPRESSIONS, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.EMOTES, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.PLAYER_INFO_CARD, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.AIRDROPPING, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.TERMS_OF_SERVICE, { active: true, visible: true })
  i.ConfigureHUDElement(HUDElementID.OPEN_EXTERNAL_URL_PROMPT, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.NFT_INFO_DIALOG, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.TELEPORT_DIALOG, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.QUESTS_PANEL, { active: questEnabled, visible: false })
  i.ConfigureHUDElement(HUDElementID.QUESTS_TRACKER, { active: questEnabled, visible: true })
  i.ConfigureHUDElement(HUDElementID.PROFILE_HUD, { active: true, visible: true })

  // The elements below, require the taskbar to be active before being activated.
  {
    i.ConfigureHUDElement(
      HUDElementID.TASKBAR,
      { active: true, visible: true },
      { enableVoiceChat: true, enableQuestPanel: questEnabled }
    )
    i.ConfigureHUDElement(HUDElementID.WORLD_CHAT_WINDOW, { active: true, visible: false })
    i.ConfigureHUDElement(HUDElementID.CONTROLS_HUD, { active: true, visible: false })
    i.ConfigureHUDElement(HUDElementID.HELP_AND_SUPPORT_HUD, { active: true, visible: false })
  }

  const configForRenderer = kernelConfigForRenderer()
  configForRenderer.comms.voiceChatEnabled = true

  i.SetKernelConfiguration(configForRenderer)
  i.ConfigureHUDElement(HUDElementID.USERS_AROUND_LIST_HUD, { active: true, visible: false })
  i.ConfigureHUDElement(HUDElementID.GRAPHIC_CARD_WARNING, { active: true, visible: true })

  await onLoginCompleted()

  const identity = getCurrentIdentity(store.getState())!
  const profile = getCurrentUserProfile(store.getState())!

  if (!profile) {
    ReportFatalError(new Error('Profile missing during unity initialization'), 'kernel#init')
    return
  }

  const enableNewTutorialCamera = worldConfig ? worldConfig.enableNewTutorialCamera ?? false : false
  const tutorialConfig = {
    fromDeepLink: HAS_INITIAL_POSITION_MARK,
    enableNewTutorialCamera: enableNewTutorialCamera
  }

  i.ConfigureTutorial(profile.tutorialStep, tutorialConfig)

  const isGuest = !identity.hasConnectedWeb3
  const friendsActivated = !isGuest && !getFeatureFlagEnabled(store.getState(), 'matrix_disabled')
  const BUILDER_IN_WORLD_ENABLED = !isGuest && getFeatureFlagEnabled(store.getState(), 'builder_in_world')

  i.ConfigureHUDElement(HUDElementID.BUILDER_PROJECTS_PANEL, { active: BUILDER_IN_WORLD_ENABLED, visible: false })
  i.ConfigureHUDElement(HUDElementID.FRIENDS, { active: friendsActivated, visible: false })

  await realmInitialized()

  function reportForeground() {
    if (isForeground()) {
      store.dispatch(renderingInForeground())
      i.ReportFocusOn()
    } else {
      store.dispatch(renderingInBackground())
      i.ReportFocusOff()
    }
  }

  foregroundChangeObservable.add(reportForeground)
  reportForeground()

  const state = store.getState()
  await startUnitySceneWorkers({
    contentServer: getFetchContentServer(state),
    catalystServer: getCatalystServer(state),
    contentServerBundles: getAssetBundlesBaseUrl(getSelectedNetwork(state)) + '/',
    worldConfig: getWorldConfig(state)
  })

  teleportObservable.notifyObservers(worldToGrid(lastPlayerPosition))

  if (options.previewMode) {
    i.SetDisableAssetBundles()
    await startPreview(i)
  }

  setTimeout(() => store.dispatch(signalEngineReady()), 0)

  return true
}

export async function startPreview(unityInterface: IUnityInterface) {
  getPreviewSceneId()
    .then((sceneData) => {
      if (sceneData.sceneId) {
        unityInterface.SetKernelConfiguration({
          debugConfig: {
            sceneDebugPanelTargetSceneId: sceneData.sceneId,
            sceneLimitsWarningSceneId: sceneData.sceneId
          }
        })
        clientDebug.ToggleSceneBoundingBoxes(sceneData.sceneId, false).catch((e) => logger.error(e))
        unityInterface.SendMessageToUnity('Main', 'TogglePreviewMenu', JSON.stringify({ enabled: true }))
      }
    })
    .catch((_err) => {
      logger.info('Warning: cannot get preview scene id')
    })

  function handleServerMessage(message: sdk.Messages) {
    if (DEBUG_WS_MESSAGES) {
      logger.info('Message received: ', message)
    }
    if (message.type === sdk.UPDATE || message.type === sdk.SCENE_UPDATE) {
      void loadPreviewScene(message)
    }
  }

  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${document.location.host}`)

  ws.addEventListener('message', (msg) => {
    if (msg.data.startsWith('{')) {
      logger.log('Update message from CLI', msg.data)
      const message: sdk.Messages = JSON.parse(msg.data)
      handleServerMessage(message)
    }
  })
}
