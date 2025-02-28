import { Vector3 } from '@dcl/ecs-math'
import { WSS_ENABLED, WORLD_EXPLORER, RESET_TUTORIAL, EDITOR } from 'config'
import type { MinimapSceneInfo } from '@dcl/legacy-ecs'
import { AirdropInfo } from 'shared/airdrops/interface'
import { HotSceneInfo, IUnityInterface, setUnityInstance } from './IUnityInterface'
import {
  HUDConfiguration,
  InstancedSpawnPoint,
  LoadableParcelScene,
  Notification,
  ChatMessage,
  HUDElementID,
  FriendsInitializationMessage,
  FriendshipUpdateStatusMessage,
  UpdateUserStatusMessage,
  RenderProfile,
  BuilderConfiguration,
  RealmsInfoForRenderer,
  ContentMapping,
  TutorialInitializationMessage,
  WorldPosition,
  HeaderRequest
} from 'shared/types'
import { nativeMsgBridge } from './nativeMessagesBridge'
import { createUnityLogger, ILogger } from 'shared/logger'
import { setDelightedSurveyEnabled } from './delightedSurvey'
import { QuestForRenderer } from '@dcl/ecs-quests/@dcl/types'
import { profileToRendererFormat } from 'shared/profiles/transformations/profileToRendererFormat'
import { WearableV2 } from 'shared/catalogs/types'
import { Observable } from 'mz-observable'
import type { UnityGame } from '@dcl/unity-renderer/src'
import { FeatureFlag } from 'shared/meta/types'
import { getProvider } from 'shared/session/index'
import { uuid } from 'atomicHelpers/math'
import future, { IFuture } from 'fp-future'
import { futures } from './BrowserInterface'
import { trackEvent } from 'shared/analytics'
import { Avatar } from '@dcl/schemas'
import { NewProfileForRenderer } from 'shared/profiles/transformations/types'

const MINIMAP_CHUNK_SIZE = 100

export let originalPixelRatio: number = 1

function resizeCanvas(targetHeight: number) {
  // When renderer is configured with unlimited resolution,
  // the targetHeight is set to an arbitrary high value
  const assumeUnlimitedResolution: boolean = targetHeight > 2000

  if (assumeUnlimitedResolution) {
    devicePixelRatio = originalPixelRatio
  } else {
    // We calculate width using height as reference
    const screenHeight = screen.height * originalPixelRatio

    const pixelRatioH = targetHeight / screenHeight

    // From 2020 version onwards, Unity hooks to devicePixelRatio to adjust
    // the FBO size instead of the canvas resize.
    devicePixelRatio = pixelRatioH * originalPixelRatio
  }
}

const unityLogger: ILogger = createUnityLogger()

export class UnityInterface implements IUnityInterface {
  public logger = unityLogger
  public gameInstance!: UnityGame
  public Module: any
  public currentHeight: number = -1
  public crashPayloadResponseObservable: Observable<string> = new Observable<string>()

  public SetTargetHeight(height: number): void {
    if (EDITOR) {
      return
    }

    if (this.currentHeight === height) {
      return
    }

    this.currentHeight = height
    resizeCanvas(height)
  }

  public Init(gameInstance: UnityGame): void {
    if (!WSS_ENABLED) {
      nativeMsgBridge.initNativeMessages(gameInstance)
    }

    this.gameInstance = gameInstance
    this.Module = this.gameInstance.Module

    if (this.Module) {
      if (EDITOR) {
        const canvas = this.Module.canvas
        canvas.width = canvas.parentElement.clientWidth
        canvas.height = canvas.parentElement.clientHeight
      } else {
        // TODO(Brian): Here we save the original pixel ratio, but we aren't listening to changes
        //              We may have to listen them for some devices?
        originalPixelRatio = devicePixelRatio
      }
    }
  }

  public SendGenericMessage(object: string, method: string, payload: string) {
    this.SendMessageToUnity(object, method, payload)
  }

  public SetDebug() {
    this.SendMessageToUnity('Main', 'SetDebug')
  }

  public LoadProfile(profile: NewProfileForRenderer) {
    this.SendMessageToUnity('Main', 'LoadProfile', JSON.stringify(profile))
  }

  public SetRenderProfile(id: RenderProfile) {
    this.SendMessageToUnity('Main', 'SetRenderProfile', JSON.stringify({ id: id }))
  }

  public CreateGlobalScene(data: {
    id: string
    name: string
    baseUrl: string
    contents: Array<ContentMapping>
    icon?: string
    isPortableExperience: boolean
  }) {
    /**
     * UI Scenes are scenes that does not check any limit or boundary. The
     * position is fixed at 0,0 and they are universe-wide. An example of this
     * kind of scenes is the Avatar scene. All the avatars are just GLTFs in
     * a scene.
     */
    this.SendMessageToUnity('Main', 'CreateGlobalScene', JSON.stringify(data))
  }

  /** Sends the camera position & target to the engine */

  public Teleport(
    { position: { x, y, z }, cameraTarget }: InstancedSpawnPoint,
    rotateIfTargetIsNotSet: boolean = true
  ) {
    const theY = y <= 0 ? 2 : y

    this.SendMessageToUnity('CharacterController', 'Teleport', JSON.stringify({ x, y: theY, z }))
    if (cameraTarget || rotateIfTargetIsNotSet) {
      this.SendMessageToUnity('CameraController', 'SetRotation', JSON.stringify({ x, y: theY, z, cameraTarget }))
    }
  }

  /** Tells the engine which scenes to load */

  public LoadParcelScenes(parcelsToLoad: LoadableParcelScene[]) {
    if (parcelsToLoad.length > 1) {
      throw new Error('Only one scene at a time!')
    }

    this.SendMessageToUnity('Main', 'LoadParcelScenes', JSON.stringify(parcelsToLoad[0]))
  }

  public UnloadScene(sceneId: string) {
    this.SendMessageToUnity('Main', 'UnloadScene', sceneId)
  }

  public SendSceneMessage(messages: string) {
    this.SendMessageToUnity(`SceneController`, `SendSceneMessage`, messages)
  }

  /** @deprecated send it with the kernelConfigForRenderer instead. */
  public SetSceneDebugPanel() {
    this.SendMessageToUnity('Main', 'SetSceneDebugPanel')
  }

  public ShowFPSPanel() {
    this.SendMessageToUnity('Main', 'ShowFPSPanel')
  }

  public HideFPSPanel() {
    this.SendMessageToUnity('Main', 'HideFPSPanel')
  }

  public SetEngineDebugPanel() {
    this.SendMessageToUnity('Main', 'SetEngineDebugPanel')
  }

  public SetDisableAssetBundles() {
    this.SendMessageToUnity('Main', 'SetDisableAssetBundles')
  }

  public async CrashPayloadRequest(): Promise<string> {
    // Over wasm this should come back on the same call stack frame because
    // the response comes within the CrashPayloadRequest method body.

    // For websocket this should take more frames, so we need promises.
    const promise = new Promise<string>((resolve, reject) => {
      const crashListener = this.crashPayloadResponseObservable.addOnce((payload) => {
        resolve(payload)
      })

      setTimeout(() => {
        this.crashPayloadResponseObservable.remove(crashListener)
        reject()
      }, 2000)

      this.SendMessageToUnity('Main', 'CrashPayloadRequest')
    })

    return promise
  }

  public ActivateRendering() {
    this.SendMessageToUnity('Main', 'ActivateRendering')
  }

  public SetLoadingScreen(data: { isVisible: boolean; message: string; showTips: boolean }) {
    if (!this.gameInstance) {
      return
    }

    this.SendMessageToUnity('Bridges', 'SetLoadingScreen', JSON.stringify(data))
  }

  public DeactivateRendering() {
    this.SendMessageToUnity('Main', 'DeactivateRendering')
  }

  public ReportFocusOn() {
    this.SendMessageToUnity('Bridges', 'ReportFocusOn')
  }

  public ReportFocusOff() {
    this.SendMessageToUnity('Bridges', 'ReportFocusOff')
  }

  public UnlockCursor() {
    this.SetCursorState(false)
  }

  public SetCursorState(locked: boolean) {
    this.SendMessageToUnity('Bridges', 'UnlockCursorBrowser', locked ? 1 : 0)
  }

  public SetBuilderReady() {
    this.SendMessageToUnity('Main', 'BuilderReady')
  }

  public AddUserProfileToCatalog(peerProfile: NewProfileForRenderer) {
    this.SendMessageToUnity('Main', 'AddUserProfileToCatalog', JSON.stringify(peerProfile))
  }

  public AddWearablesToCatalog(wearables: WearableV2[], context?: string) {
    this.SendMessageToUnity('Main', 'AddWearablesToCatalog', JSON.stringify({ wearables, context }))
  }

  public WearablesRequestFailed(error: string, context: string | undefined) {
    this.SendMessageToUnity('Main', 'WearablesRequestFailed', JSON.stringify({ error, context }))
  }

  public RemoveWearablesFromCatalog(wearableIds: string[]) {
    this.SendMessageToUnity('Main', 'RemoveWearablesFromCatalog', JSON.stringify(wearableIds))
  }

  public ClearWearableCatalog() {
    this.SendMessageToUnity('Main', 'ClearWearableCatalog')
  }

  public ShowNotification(notification: Notification) {
    this.SendMessageToUnity('HUDController', 'ShowNotificationFromJson', JSON.stringify(notification))
  }

  public ConfigureHUDElement(
    hudElementId: HUDElementID,
    configuration: HUDConfiguration,
    extraPayload: any | null = null
  ) {
    this.SendMessageToUnity(
      'HUDController',
      `ConfigureHUDElement`,
      JSON.stringify({
        hudElementId: hudElementId,
        configuration: configuration,
        extraPayload: extraPayload ? JSON.stringify(extraPayload) : null
      })
    )
  }

  public ShowWelcomeNotification() {
    this.SendMessageToUnity('HUDController', 'ShowWelcomeNotification')
  }

  public TriggerSelfUserExpression(expressionId: string) {
    this.SendMessageToUnity('HUDController', 'TriggerSelfUserExpression', expressionId)
  }

  public UpdateMinimapSceneInformation(info: MinimapSceneInfo[]) {
    for (let i = 0; i < info.length; i += MINIMAP_CHUNK_SIZE) {
      const chunk = info.slice(i, i + MINIMAP_CHUNK_SIZE)
      this.SendMessageToUnity('Main', 'UpdateMinimapSceneInformation', JSON.stringify(chunk))
    }
  }

  public SetTutorialEnabled(tutorialConfig: TutorialInitializationMessage) {
    this.SendMessageToUnity('TutorialController', 'SetTutorialEnabled', JSON.stringify(tutorialConfig))
  }

  public SetTutorialEnabledForUsersThatAlreadyDidTheTutorial(tutorialConfig: TutorialInitializationMessage) {
    this.SendMessageToUnity(
      'TutorialController',
      'SetTutorialEnabledForUsersThatAlreadyDidTheTutorial',
      JSON.stringify(tutorialConfig)
    )
  }

  public TriggerAirdropDisplay(_data: AirdropInfo) {
    // Disabled for security reasons
  }

  public AddMessageToChatWindow(message: ChatMessage) {
    try {
      message.body = message.body.replace(/</g, 'ᐸ').replace(/>/g, 'ᐳ')
    } catch (err: any) {
      unityLogger.error(err)
    }
    if (message.body.length > 1000) {
      trackEvent('long_chat_message_ignored', { message: message.body, sender: message.sender })
      return
    }
    this.SendMessageToUnity('Main', 'AddMessageToChatWindow', JSON.stringify(message))
  }

  public InitializeFriends(initializationMessage: FriendsInitializationMessage) {
    this.SendMessageToUnity('Main', 'InitializeFriends', JSON.stringify(initializationMessage))
  }

  public UpdateFriendshipStatus(updateMessage: FriendshipUpdateStatusMessage) {
    this.SendMessageToUnity('Main', 'UpdateFriendshipStatus', JSON.stringify(updateMessage))
  }

  public UpdateUserPresence(status: UpdateUserStatusMessage) {
    this.SendMessageToUnity('Main', 'UpdateUserPresence', JSON.stringify(status))
  }

  public FriendNotFound(queryString: string) {
    this.SendMessageToUnity('Main', 'FriendNotFound', JSON.stringify(queryString))
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public RequestTeleport(teleportData: {}) {
    this.SendMessageToUnity('HUDController', 'RequestTeleport', JSON.stringify(teleportData))
  }

  public UpdateHotScenesList(info: HotSceneInfo[]) {
    const chunks: any[] = []

    while (info.length) {
      chunks.push(info.splice(0, MINIMAP_CHUNK_SIZE))
    }

    for (let i = 0; i < chunks.length; i++) {
      const payload = { chunkIndex: i, chunksCount: chunks.length, scenesInfo: chunks[i] }
      this.SendMessageToUnity('Main', 'UpdateHotScenesList', JSON.stringify(payload))
    }
  }

  public ConnectionToRealmSuccess(successData: WorldPosition) {
    this.SendMessageToUnity('Bridges', 'ConnectionToRealmSuccess', JSON.stringify(successData))
  }

  public ConnectionToRealmFailed(failedData: WorldPosition) {
    this.SendMessageToUnity('Bridges', 'ConnectionToRealmFailed', JSON.stringify(failedData))
  }

  public SendGIFPointers(id: string, width: number, height: number, pointers: number[], frameDelays: number[]) {
    this.SendMessageToUnity('Main', 'UpdateGIFPointers', JSON.stringify({ id, width, height, pointers, frameDelays }))
  }

  public SendGIFFetchFailure(id: string) {
    this.SendMessageToUnity('Main', 'FailGIFFetch', id)
  }

  public ConfigureTutorial(tutorialStep: number, tutorialConfig: TutorialInitializationMessage) {
    const tutorialCompletedFlag = 256

    if (WORLD_EXPLORER) {
      if (RESET_TUTORIAL || (tutorialStep & tutorialCompletedFlag) === 0) {
        this.SetTutorialEnabled(tutorialConfig)
      } else {
        this.SetTutorialEnabledForUsersThatAlreadyDidTheTutorial(tutorialConfig)
        setDelightedSurveyEnabled(true)
      }
    }
  }

  public UpdateBalanceOfMANA(balance: string) {
    this.SendMessageToUnity('HUDController', 'UpdateBalanceOfMANA', balance)
  }

  public RequestWeb3ApiUse(requestType: string, payload: any): IFuture<boolean> {
    const isWalletConnect = (getProvider() as any).wc !== undefined

    const id = uuid()
    futures[id] = future()

    if (!isWalletConnect) {
      futures[id].resolve(true)
    } else {
      this.SendMessageToUnity('Bridges', 'RequestWeb3ApiUse', JSON.stringify({ id, requestType, payload }))
    }

    return futures[id]
  }

  public SetPlayerTalking(talking: boolean) {
    this.SendMessageToUnity('HUDController', 'SetPlayerTalking', JSON.stringify(talking))
  }

  public ShowAvatarEditorInSignIn() {
    this.SendMessageToUnity('HUDController', 'ShowAvatarEditorInSignUp')
    this.SendMessageToUnity('Main', 'ForceActivateRendering')
  }

  public SetUserTalking(userId: string, talking: boolean) {
    this.SendMessageToUnity('HUDController', 'SetUserTalking', JSON.stringify({ userId: userId, talking: talking }))
  }

  public SetUsersMuted(usersId: string[], muted: boolean) {
    this.SendMessageToUnity('HUDController', 'SetUsersMuted', JSON.stringify({ usersId: usersId, muted: muted }))
  }

  public SetVoiceChatEnabledByScene(enabled: boolean) {
    this.SendMessageToUnity('HUDController', 'SetVoiceChatEnabledByScene', enabled ? 1 : 0)
  }

  public SetKernelConfiguration(config: any) {
    this.SendMessageToUnity('Bridges', 'SetKernelConfiguration', JSON.stringify(config))
  }

  public SetFeatureFlagsConfiguration(config: FeatureFlag) {
    this.SendMessageToUnity('Bridges', 'SetFeatureFlagConfiguration', JSON.stringify(config))
  }

  public UpdateRealmsInfo(realmsInfo: Partial<RealmsInfoForRenderer>) {
    this.SendMessageToUnity('Bridges', 'UpdateRealmsInfo', JSON.stringify(realmsInfo))
  }

  public SendPublishSceneResult() {
    this.logger.warn('SendPublishSceneResult')
  }

  public SendBuilderProjectInfo(projectName: string, projectDescription: string, isNewEmptyProject: boolean) {
    this.SendMessageToUnity(
      'Main',
      'BuilderProjectInfo',
      JSON.stringify({ title: projectName, description: projectDescription, isNewEmptyProject: isNewEmptyProject })
    )
  }

  // Note: This message is deprecated and should be deleted in the future.
  //       We are maintaining it for backward compatibility  we can safely delete if we are further than 2/03/2022
  public SendBuilderCatalogHeaders(headers: Record<string, string>) {
    this.SendMessageToUnity('Main', 'BuilderInWorldCatalogHeaders', JSON.stringify(headers))
  }

  public SendHeaders(endpoint: string, headers: Record<string, string>) {
    const request: HeaderRequest = {
      endpoint: endpoint,
      headers: headers
    }
    this.SendMessageToUnity('Main', 'RequestedHeaders', JSON.stringify(request))
  }

  public SendSceneAssets() {
    this.logger.warn('SendSceneAssets')
  }

  public SetENSOwnerQueryResult(searchInput: string, profiles: Avatar[] | undefined) {
    if (!profiles) {
      this.SendMessageToUnity('Bridges', 'SetENSOwnerQueryResult', JSON.stringify({ searchInput, success: false }))
      return
    }
    // TODO: why do we send the whole profile while asking for the ENS???
    const profilesForRenderer: NewProfileForRenderer[] = []
    for (const profile of profiles) {
      profilesForRenderer.push(profileToRendererFormat(profile, { address: profile.userId }))
    }
    this.SendMessageToUnity(
      'Bridges',
      'SetENSOwnerQueryResult',
      JSON.stringify({ searchInput, success: true, profiles: profilesForRenderer })
    )
  }

  public SendUnpublishSceneResult() {
    this.logger.warn('SendUnpublishSceneResult')
  }

  // *********************************************************************************
  // ************** Quests messages **************
  // *********************************************************************************

  InitQuestsInfo(rendererQuests: QuestForRenderer[]) {
    this.SendMessageToUnity('Bridges', 'InitializeQuests', JSON.stringify(rendererQuests))
  }

  UpdateQuestProgress(rendererQuest: QuestForRenderer) {
    this.SendMessageToUnity('Bridges', 'UpdateQuestProgress', JSON.stringify(rendererQuest))
  }

  // *********************************************************************************
  // ************** Builder messages **************
  // *********************************************************************************
  // @internal

  public SendBuilderMessage(method: string, payload: string = '') {
    this.SendMessageToUnity(`BuilderController`, method, payload)
  }

  public SelectGizmoBuilder(type: string) {
    this.SendBuilderMessage('SelectGizmo', type)
  }

  public ResetBuilderObject() {
    this.SendBuilderMessage('ResetObject')
  }

  public SetCameraZoomDeltaBuilder(delta: number) {
    this.SendBuilderMessage('ZoomDelta', delta.toString())
  }

  public GetCameraTargetBuilder(futureId: string) {
    this.SendBuilderMessage('GetCameraTargetBuilder', futureId)
  }

  public SetPlayModeBuilder(on: string) {
    this.SendBuilderMessage('SetPlayMode', on)
  }

  public PreloadFileBuilder(url: string) {
    this.SendBuilderMessage('PreloadFile', url)
  }

  public GetMousePositionBuilder(x: string, y: string, id: string) {
    this.SendBuilderMessage('GetMousePosition', `{"x":"${x}", "y": "${y}", "id": "${id}" }`)
  }

  public TakeScreenshotBuilder(id: string) {
    this.SendBuilderMessage('TakeScreenshot', id)
  }

  public SetCameraPositionBuilder(position: Vector3) {
    this.SendBuilderMessage('SetBuilderCameraPosition', position.x + ',' + position.y + ',' + position.z)
  }

  public SetCameraRotationBuilder(aplha: number, beta: number) {
    this.SendBuilderMessage('SetBuilderCameraRotation', aplha + ',' + beta)
  }

  public ResetCameraZoomBuilder() {
    this.SendBuilderMessage('ResetBuilderCameraZoom')
  }

  public SetBuilderGridResolution(position: number, rotation: number, scale: number) {
    this.SendBuilderMessage(
      'SetGridResolution',
      JSON.stringify({ position: position, rotation: rotation, scale: scale })
    )
  }

  public SetBuilderSelectedEntities(entities: string[]) {
    this.SendBuilderMessage('SetSelectedEntities', JSON.stringify({ entities: entities }))
  }

  public ResetBuilderScene() {
    this.SendBuilderMessage('ResetBuilderScene')
  }

  public OnBuilderKeyDown(key: string) {
    this.SendBuilderMessage('OnBuilderKeyDown', key)
  }

  public SetBuilderConfiguration(config: BuilderConfiguration) {
    this.SendBuilderMessage('SetBuilderConfiguration', JSON.stringify(config))
  }

  // NOTE: we override wasm's setThrew function before sending message to unity and restore it to it's
  // original function after message is sent. If an exception is thrown during SendMessage we assume that it's related
  // to the code executed by the SendMessage on unity's side.
  public SendMessageToUnity(object: string, method: string, payload: any = undefined) {
    // "this.Module" is not present when using remote websocket renderer, so we just send the message to unity without doing any override.
    if (!this.Module) {
      this.gameInstance.SendMessage(object, method, payload)
      return
    }

    const originalSetThrew = this.Module['setThrew']
    const unityModule = this.Module

    function overrideSetThrew() {
      unityModule['setThrew'] = function () {
        trackEvent('renderer_set_threw', {
          method,
          object,
          payload,
          stack: new Error().stack || '?'
        })
        const error = `Error while sending Message to Unity. Object: ${object}. Method: ${method}. Payload: ${payload}.`
        unityLogger.error(error)
        // eslint-disable-next-line prefer-rest-params
        return originalSetThrew.apply(this, arguments)
      }
    }

    function restoreSetThrew() {
      unityModule['setThrew'] = originalSetThrew
    }

    overrideSetThrew()
    try {
      this.gameInstance.SendMessage(object, method, payload)
    } finally {
      restoreSetThrew()
    }
  }
}

setUnityInstance(new UnityInterface())
