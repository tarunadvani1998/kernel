import { AnyAction } from 'redux'
import { fork, put, race, select, take, takeEvery, takeLatest } from 'redux-saga/effects'

import { PARCEL_LOADING_STARTED, RENDERER_INITIALIZED_CORRECTLY } from 'shared/renderer/types'
import { ChangeLoginStateAction, CHANGE_LOGIN_STAGE } from 'shared/session/actions'
import { trackEvent } from '../analytics'
import { lastPlayerPosition } from '../world/positionThings'

import {
  PENDING_SCENES,
  SceneFail,
  SceneLoad,
  SCENE_FAIL,
  SCENE_LOAD,
  SCENE_START,
  updateLoadingScreen,
  UPDATE_LOADING_SCREEN
} from './actions'
import {
  metricsUnityClientLoaded,
  metricsAuthSuccessful,
  experienceStarted,
  RENDERING_ACTIVATED,
  RENDERING_DEACTIVATED,
  RENDERING_BACKGROUND,
  RENDERING_FOREGROUND
} from './types'
import { getCurrentUserId } from 'shared/session/selectors'
import { LoginState } from '@dcl/kernel-interface'
import { call } from 'redux-saga-test-plan/matchers'
import { RootState } from 'shared/store/rootTypes'
import { onLoginCompleted } from 'shared/session/sagas'
import { getResourcesURL } from 'shared/location'
import { getCatalystServer, getFetchContentServer, getSelectedNetwork } from 'shared/dao/selectors'
import { getAssetBundlesBaseUrl } from 'config'
import { waitForRendererInstance } from 'shared/renderer/sagas'
import { getParcelLoadingStarted } from 'shared/renderer/selectors'
import { getUnityInstance } from 'unity-interface/IUnityInterface'
import { isLoadingScreenVisible, getLoadingState } from './selectors'

// The following actions may change the status of the loginVisible
const ACTIONS_FOR_LOADING = [
  PARCEL_LOADING_STARTED,
  SCENE_LOAD,
  SCENE_FAIL,
  CHANGE_LOGIN_STAGE,
  RENDERER_INITIALIZED_CORRECTLY,
  RENDERING_BACKGROUND,
  RENDERING_FOREGROUND,
  RENDERING_ACTIVATED,
  RENDERING_DEACTIVATED,
  PENDING_SCENES
]

export function* loadingSaga() {
  yield takeEvery(SCENE_LOAD, trackLoadTime)
  yield takeEvery(SCENE_FAIL, reportFailedScene)

  yield fork(translateActions)
  yield fork(initialSceneLoading)

  yield takeLatest(ACTIONS_FOR_LOADING, function* () {
    yield put(updateLoadingScreen())
  })

  yield takeLatest(UPDATE_LOADING_SCREEN, function* () {
    yield call(waitForRendererInstance)

    const isVisible = yield select(isLoadingScreenVisible)
    const loadingState = yield select(getLoadingState)
    const parcelLoadingStarted = yield select(getParcelLoadingStarted)
    const loadingScreen = {
      isVisible,
      message: loadingState.message || loadingState.status || '',
      showTips: loadingState.initialLoad || !parcelLoadingStarted
    }
    getUnityInstance().SetLoadingScreen(loadingScreen)
  })
}

function* reportFailedScene(action: SceneFail) {
  const sceneId = action.payload
  const fullRootUrl = getResourcesURL('.')

  trackEvent('scene_loading_failed', {
    sceneId,
    contentServer: yield select(getFetchContentServer),
    catalystServer: yield select(getCatalystServer),
    contentServerBundles: getAssetBundlesBaseUrl(yield select(getSelectedNetwork)) + '/',
    rootUrl: fullRootUrl
  })
}

function* translateActions() {
  yield takeEvery(RENDERER_INITIALIZED_CORRECTLY, triggerUnityClientLoaded)
  yield takeEvery(CHANGE_LOGIN_STAGE, triggerAuthSuccessful)
}

function* triggerAuthSuccessful(action: ChangeLoginStateAction) {
  if (action.payload.stage === LoginState.COMPLETED) {
    yield put(metricsAuthSuccessful())
  }
}

function* triggerUnityClientLoaded() {
  yield put(metricsUnityClientLoaded())
}

export function* trackLoadTime(action: SceneLoad): any {
  const start = new Date().getTime()
  const sceneId = action.payload
  const result = yield race({
    start: take((action: AnyAction) => action.type === SCENE_START && action.payload === sceneId),
    fail: take((action: AnyAction) => action.type === SCENE_FAIL && action.payload === sceneId)
  })
  const userId = yield select(getCurrentUserId)
  const position = lastPlayerPosition
  trackEvent('SceneLoadTimes', {
    position: { ...position },
    elapsed: new Date().getTime() - start,
    success: !!result.start,
    sceneId,
    userId: userId
  })
}

function* waitForSceneLoads() {
  function shouldWaitForScenes(state: RootState) {
    if (!state.renderer.parcelLoadingStarted) {
      return true
    }

    // in the initial load, we should wait until we have *some* scene to load
    if (state.loading.initialLoad) {
      if (state.loading.pendingScenes !== 0 || state.loading.totalScenes === 0) {
        return true
      }
    }

    // otherwise only wait until pendingScenes == 0
    return state.loading.pendingScenes !== 0
  }

  while (yield select(shouldWaitForScenes)) {
    // these are the events that _may_ change the result of shouldWaitForScenes
    yield take(ACTIONS_FOR_LOADING)
  }

  // trigger the signal to apply the state in the renderer
  yield put(updateLoadingScreen())
}

function* initialSceneLoading() {
  yield call(onLoginCompleted)
  yield call(waitForSceneLoads)
  yield put(experienceStarted())
}
