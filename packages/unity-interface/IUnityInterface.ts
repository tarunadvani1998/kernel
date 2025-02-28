/* eslint-disable @typescript-eslint/ban-types */
import { Vector3 } from '@dcl/ecs-math'
import { QuestForRenderer } from '@dcl/ecs-quests/@dcl/types'
import type { UnityGame } from '@dcl/unity-renderer/src'
import { Observable } from 'mz-observable'
import type { MinimapSceneInfo } from '@dcl/legacy-ecs'
import { AirdropInfo } from '../shared/airdrops/interface'
import {
  RenderProfile,
  ContentMapping,
  InstancedSpawnPoint,
  LoadableParcelScene,
  WearableV2,
  HUDElementID,
  HUDConfiguration,
  RealmsInfoForRenderer,
  BuilderConfiguration,
  ChatMessage,
  FriendshipUpdateStatusMessage,
  FriendsInitializationMessage,
  TutorialInitializationMessage,
  Notification,
  UpdateUserStatusMessage,
  WorldPosition
} from '../shared/types'
import { FeatureFlag } from 'shared/meta/types'
import { IFuture } from 'fp-future'
import { Avatar } from '@dcl/schemas'
import { ILogger } from 'shared/logger'
import { NewProfileForRenderer } from 'shared/profiles/transformations/types'

export type RealmInfo = {
  serverName: string
  layer?: string
  usersCount: number
  usersMax: number
  userParcels: { x: number; y: number }[]
}

export type HotSceneInfo = {
  id: string
  name: string
  creator: string
  description: string
  thumbnail: string
  baseCoords: { x: number; y: number }
  parcels: { x: number; y: number }[]
  usersTotalCount: number
  realms: RealmInfo[]
}

let instance: IUnityInterface | null = null

export function setUnityInstance(_instance: IUnityInterface) {
  instance = _instance
}

export function getUnityInstance(): IUnityInterface {
  if (!instance) throw new Error('unityInstance not initialized yet')
  return instance
}

export interface IUnityInterface {
  gameInstance: UnityGame
  Module: any
  crashPayloadResponseObservable: Observable<string>
  logger: ILogger
  SetTargetHeight(height: number): void
  Init(gameInstance: UnityGame): void
  SendGenericMessage(object: string, method: string, payload: string): void
  SetDebug(): void
  LoadProfile(profile: NewProfileForRenderer): void
  SetRenderProfile(id: RenderProfile): void
  CreateGlobalScene(data: {
    id: string
    name: string
    baseUrl: string
    contents: Array<ContentMapping>
    icon?: string
    isPortableExperience: boolean
  }): void

  /** Sends the camera position & target to the engine */

  Teleport(
    {
      position: { x, y, z },
      cameraTarget
    }: InstancedSpawnPoint,
    rotateIfTargetIsNotSet?: boolean
  ): void

  /** Tells the engine which scenes to load */

  LoadParcelScenes(parcelsToLoad: LoadableParcelScene[]): void
  UnloadScene(sceneId: string): void
  SendSceneMessage(messages: string): void
  /** @deprecated send it with the kernelConfigForRenderer instead. */
  SetSceneDebugPanel(): void
  ShowFPSPanel(): void
  HideFPSPanel(): void
  SetEngineDebugPanel(): void
  SetDisableAssetBundles(): void
  CrashPayloadRequest(): Promise<string>
  ActivateRendering(): void
  SetLoadingScreen(data: { isVisible: boolean; message: string; showTips: boolean }): void
  DeactivateRendering(): void
  ReportFocusOn(): void
  ReportFocusOff(): void
  UnlockCursor(): void
  SetCursorState(locked: boolean): void
  SetBuilderReady(): void
  AddUserProfileToCatalog(peerProfile: NewProfileForRenderer): void
  AddWearablesToCatalog(wearables: WearableV2[], context?: string): void
  WearablesRequestFailed(error: string, context: string | undefined): void
  RemoveWearablesFromCatalog(wearableIds: string[]): void
  ClearWearableCatalog(): void
  ShowNotification(notification: Notification): void
  ConfigureHUDElement(hudElementId: HUDElementID, configuration: HUDConfiguration, extraPayload?: any): void
  ShowWelcomeNotification(): void
  TriggerSelfUserExpression(expressionId: string): void
  UpdateMinimapSceneInformation(info: MinimapSceneInfo[]): void
  SetTutorialEnabled(tutorialConfig: TutorialInitializationMessage): void
  SetTutorialEnabledForUsersThatAlreadyDidTheTutorial(tutorialConfig: TutorialInitializationMessage): void
  TriggerAirdropDisplay(data: AirdropInfo): void
  AddMessageToChatWindow(message: ChatMessage): void
  InitializeFriends(initializationMessage: FriendsInitializationMessage): void
  UpdateFriendshipStatus(updateMessage: FriendshipUpdateStatusMessage): void
  UpdateUserPresence(status: UpdateUserStatusMessage): void
  FriendNotFound(queryString: string): void
  RequestTeleport(teleportData: {}): void
  UpdateHotScenesList(info: HotSceneInfo[]): void
  ConnectionToRealmSuccess(successData: WorldPosition): void
  ConnectionToRealmFailed(failedData: WorldPosition): void
  SendGIFPointers(id: string, width: number, height: number, pointers: number[], frameDelays: number[]): void
  SendGIFFetchFailure(id: string): void
  ConfigureTutorial(tutorialStep: number, tutorialConfig: TutorialInitializationMessage): void
  UpdateBalanceOfMANA(balance: string): void
  RequestWeb3ApiUse(requestType: string, payload: any): IFuture<boolean>
  SetPlayerTalking(talking: boolean): void
  ShowAvatarEditorInSignIn(): void
  SetUserTalking(userId: string, talking: boolean): void
  SetUsersMuted(usersId: string[], muted: boolean): void
  SetVoiceChatEnabledByScene(enabled: boolean): void
  SetKernelConfiguration(config: any): void
  SetFeatureFlagsConfiguration(config: FeatureFlag): void
  UpdateRealmsInfo(realmsInfo: Partial<RealmsInfoForRenderer>): void
  SetENSOwnerQueryResult(searchInput: string, profiles: Avatar[] | undefined): void
  SendHeaders(endpoint: string, headers: Record<string, string>): void

  // *********************************************************************************
  // ************** Builder in world messages **************
  // *********************************************************************************

  SendPublishSceneResult(): void
  SendBuilderProjectInfo(projectName: string, projectDescription: string, isNewEmptyProject: boolean): void
  SendSceneAssets(): void
  SendUnpublishSceneResult(): void

  //Note: This message is deprecated and should be deleted in the future.
  //      We are maintaining it for backward compatibility we can safely delete if we are further than 2/03/2022
  SendBuilderCatalogHeaders(headers: Record<string, string>): void

  // *********************************************************************************
  // ************** Quests messages **************
  // *********************************************************************************

  InitQuestsInfo(rendererQuests: QuestForRenderer[]): void
  UpdateQuestProgress(rendererQuest: QuestForRenderer): void

  // *********************************************************************************
  // ************** Builder messages **************
  // *********************************************************************************

  SendBuilderMessage(method: string, payload: string): void
  SelectGizmoBuilder(type: string): void
  ResetBuilderObject(): void
  SetCameraZoomDeltaBuilder(delta: number): void
  GetCameraTargetBuilder(futureId: string): void
  SetPlayModeBuilder(on: string): void
  PreloadFileBuilder(url: string): void
  GetMousePositionBuilder(x: string, y: string, id: string): void
  TakeScreenshotBuilder(id: string): void
  SetCameraPositionBuilder(position: Vector3): void
  SetCameraRotationBuilder(aplha: number, beta: number): void
  ResetCameraZoomBuilder(): void
  SetBuilderGridResolution(position: number, rotation: number, scale: number): void
  SetBuilderSelectedEntities(entities: string[]): void
  ResetBuilderScene(): void
  OnBuilderKeyDown(key: string): void
  SetBuilderConfiguration(config: BuilderConfiguration): void
  SendMessageToUnity(object: string, method: string, payload?: any): void
}
