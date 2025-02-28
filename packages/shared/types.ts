/* eslint-disable @typescript-eslint/ban-types */
import type { Vector3Component, Vector2Component } from '../atomicHelpers/landHelpers'
import type { QueryType } from '@dcl/legacy-ecs'
import type { WearableId } from 'shared/catalogs/types'
import { Entity, Scene, Snapshots } from '@dcl/schemas'
export { WearableId, Wearable, WearableV2 } from './catalogs/types'

export type MappingsResponse = {
  parcel_id: string
  root_cid: string
  contents: Array<ContentMapping>
}

export type ParcelInfoResponse = {
  scene_cid: string
  root_cid: string
  content: MappingsResponse
}

export type ContentMapping = { file: string; hash: string }

export interface MessageDict {
  [key: string]: string
}

/** THIS TYPE IS APPEND ONLY BECAUSE IT IS USED FOR THE SDK APIs */
export type UserData = {
  displayName: string
  publicKey: string | null
  hasConnectedWeb3: boolean
  userId: string
  version: number
  avatar: AvatarForUserData
}

export type ColorString = string

export type AvatarForUserData = {
  bodyShape: WearableId
  skinColor: ColorString
  hairColor: ColorString
  eyeColor: ColorString
  wearables: WearableId[]
  snapshots: Snapshots
}

export type MessageEntry = {
  id: string
  isCommand: boolean
  sender: string | undefined
  recipient?: string | undefined
  message: string
  timestamp: number
}

export interface IChatCommand {
  name: string
  description: string
  run: (message: string) => MessageEntry
}

export type RPCSendableMessage = {
  jsonrpc: '2.0'
  id: number
  method: string
  params: any[]
}

export type EntityActionType =
  | 'CreateEntity'
  | 'RemoveEntity'
  | 'SetEntityParent'
  | 'UpdateEntityComponent'
  | 'AttachEntityComponent'
  | 'ComponentCreated'
  | 'ComponentDisposed'
  | 'ComponentRemoved'
  | 'ComponentUpdated'
  | 'Query'
  | 'InitMessagesFinished'
  | 'OpenExternalUrl'
  | 'OpenNFTDialog'

export type QueryPayload = { queryId: string; payload: RayQuery }

export type CreateEntityPayload = { id: string }

export type RemoveEntityPayload = { id: string }
export type SceneStartedPayload = {}

export type SetEntityParentPayload = {
  entityId: string
  parentId: string
}

export type ComponentRemovedPayload = {
  entityId: string
  name: string
}

export type UpdateEntityComponentPayload = {
  entityId: string
  classId: number
  name: string
  json: string
}

export type ComponentCreatedPayload = {
  id: string
  classId: number
  name: string
}

export type AttachEntityComponentPayload = {
  entityId: string
  name: string
  id: string
}

export type ComponentDisposedPayload = {
  id: string
}

export type ComponentUpdatedPayload = {
  id: string
  json: string
}

export type EntityAction = {
  type: EntityActionType
  tag?: string
  payload: any
}

export type OpenNFTDialogPayload = { assetContractAddress: string; tokenId: string; comment: string | null }

/** THIS INTERFACE CANNOT CHANGE, IT IS USED IN THE UNITY BUILD */
export type LoadableParcelScene = {
  id: string
  name: string
  basePosition: { x: number; y: number }
  parcels: Array<{ x: number; y: number }>
  contents: Array<ContentMapping>
  baseUrl: string
  baseUrlBundles: string
  loadableScene: LoadableScene
}

/** THIS INTERFACE CANNOT CHANGE, IT IS USED IN THE UNITY BUILD */
export type LoadablePortableExperienceScene = LoadableParcelScene & {
  icon?: string
}

export const BillboardModes = {
  BILLBOARDMODE_NONE: 0,
  BILLBOARDMODE_X: 1,
  BILLBOARDMODE_Y: 2,
  BILLBOARDMODE_Z: 4,
  BILLBOARDMODE_ALL: 7
}

export const TextureSamplingMode = {
  NEAREST: 1,
  BILINEAR: 2,
  TRILINEAR: 3
}

export const TextureWrapping = {
  CLAMP: 0,
  WRAP: 1,
  MIRROR: 2
}

export type BillboardModes = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export const TransparencyModes = {
  OPAQUE: 0,
  ALPHATEST: 1,
  ALPHABLEND: 2,
  ALPHATESTANDBLEND: 3
}

export type TransparencyModes = 0 | 1 | 2 | 3

export type SceneCommunications = {
  commServerUrl: string | null
}

export type SceneDisplay = {
  title?: string
  favicon?: string
  description?: string
  navmapThumbnail?: string
}

export type SceneParcels = {
  base: string // base parcel
  parcels: string[]
}

export type SceneContact = {
  name?: string
  email?: string
  im?: string
  url?: string
}

export type ScenePolicy = {
  contentRating?: string
  fly?: boolean
  voiceEnabled?: boolean
  blacklist?: string[]
  teleportPosition?: string
}

export type SceneSource = {
  origin?: string
  projectId?: string
  version?: number
  rotation?: SceneSourcePlacement['rotation']
  point?: SceneSourcePlacement['point']
  layout?: SceneSourcePlacement['layout']
  isEmpty?: boolean
}

export type SceneSourcePlacement = {
  rotation: 'north' | 'east' | 'south' | 'west'
  point: { x: number; y: number }
  layout: { cols: number; rows: number }
}

export type SceneFeatureToggle = {
  name: string
  default: 'enabled' | 'disabled'
}

export const VOICE_CHAT_FEATURE_TOGGLE: SceneFeatureToggle = { name: 'voiceChat', default: 'enabled' }

export type LoadableScene = {
  readonly entity: Readonly<Omit<Entity, 'id'>>
  readonly baseUrl: string
  readonly id: string
  /** Id of the parent scene that spawned this scene experience */
  readonly parentCid?: string
}

export interface ILand {
  /**
   * sceneId: Now it is either an internal identifier or the rootCID.
   * In the future will change to the sceneCID
   */
  sceneId: string
  sceneJsonData: Scene
  baseUrl: string
  baseUrlBundles: string
  mappingsResponse: MappingsResponse
}

export interface IPortableExperience {
  cid: string
  baseUrl: string
  baseUrlBundles: string
  sceneJsonData: Scene
  mappingsResponse: MappingsResponse
}

export type SceneSpawnPoint = {
  name?: string
  position: {
    x: number | number[]
    y: number | number[]
    z: number | number[]
  }
  default?: boolean
  cameraTarget?: Vector3Component
}

export type InstancedSpawnPoint = { position: Vector3Component; cameraTarget?: Vector3Component }

export type SoundComponent = {
  /** Distance fading model, default: 'linear' */
  distanceModel?: 'linear' | 'inverse' | 'exponential'
  /** Does the sound loop? default: false */
  loop?: boolean
  /** The src of the sound to be played */
  src: string
  /** Volume of the sound, values 0 to 1, default: 1 */
  volume?: number
  /** Used in inverse and exponential distance models, default: 1 */
  rolloffFactor?: number
  /** Is the sound playing?, default: true */
  playing?: boolean
}

export type TransitionValue = {
  duration: number
  timing?: TimingFunction
  delay?: number
}

export type TimingFunction =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'quadratic-in'
  | 'quadratic-out'
  | 'quadratic-inout'
  | 'cubic-in'
  | 'cubic-out'
  | 'cubic-inout'
  | 'quartic-in'
  | 'quartic-out'
  | 'quartic-inout'
  | 'quintic-in'
  | 'quintic-out'
  | 'quintic-inout'
  | 'sin-in'
  | 'sin-out'
  | 'sin-inout'
  | 'exponential-in'
  | 'exponential-out'
  | 'exponential-inout'
  | 'bounce-in'
  | 'bounce-out'
  | 'bounce-inout'
  | 'elastic-in'
  | 'elastic-out'
  | 'elastic-inout'
  | 'circular-in'
  | 'circular-out'
  | 'circular-inout'
  | 'back-in'
  | 'back-out'
  | 'back-inout'

export type TransitionComponent = {
  position?: TransitionValue
  rotation?: TransitionValue
  scale?: TransitionValue
  color?: TransitionValue
  lookAt?: TransitionValue
}

export type SkeletalAnimationValue = {
  /**
   * Name of the clip (ID)
   */
  name: string

  /**
   * Name of the animation in the model
   */
  clip: string

  /**
   * Does the animation loop?, default: true
   */
  looping?: boolean

  /**
   * Weight of the animation, values from 0 to 1, used to blend several animations. default: 1
   */
  weight?: number

  /**
   * The animation speed
   */
  speed?: number

  /**
   * Is the animation playing? default: true
   */
  playing?: boolean

  /**
   * Does any anyone asked to reset the animation? default: false
   */
  shouldReset?: boolean
}

export type SkeletalAnimationComponent = {
  states: SkeletalAnimationValue[]
}

export type Ray = {
  origin: Vector3Component
  direction: Vector3Component
  distance: number
}

export type RayQuery = {
  queryId: string
  queryType: QueryType
  ray: Ray
}

export enum NotificationType {
  GENERIC = 0,
  SCRIPTING_ERROR = 1,
  COMMS_ERROR = 2
}

export type Notification = {
  type: NotificationType
  message: string
  buttonMessage: string
  timer: number // in seconds
  scene?: string
  externalCallbackID?: string
}

export enum RenderProfile {
  DEFAULT = 0,
  HALLOWEEN = 1,
  XMAS = 2,
  NIGHT = 3
}

export enum HUDElementID {
  NONE = 0,
  MINIMAP = 1,
  PROFILE_HUD = 2,
  NOTIFICATION = 3,
  AVATAR_EDITOR = 4,
  SETTINGS_PANEL = 5,

  /** @deprecaed */
  EXPRESSIONS = 6,

  PLAYER_INFO_CARD = 7,
  AIRDROPPING = 8,
  TERMS_OF_SERVICE = 9,
  WORLD_CHAT_WINDOW = 10,
  TASKBAR = 11,
  MESSAGE_OF_THE_DAY = 12,
  FRIENDS = 13,
  OPEN_EXTERNAL_URL_PROMPT = 14,
  NFT_INFO_DIALOG = 16,
  TELEPORT_DIALOG = 17,
  CONTROLS_HUD = 18,

  /** @deprecated */
  EXPLORE_HUD = 19,

  HELP_AND_SUPPORT_HUD = 20,

  /** @deprecated */
  EMAIL_PROMPT = 21,

  USERS_AROUND_LIST_HUD = 22,
  GRAPHIC_CARD_WARNING = 23,
  BUILD_MODE = 24,
  QUESTS_PANEL = 26,
  QUESTS_TRACKER = 27,
  BUILDER_PROJECTS_PANEL = 28,
  SIGNUP = 29,
  LOADING_HUD = 30,
  AVATAR_NAMES = 31,
  EMOTES = 32
}

export type HUDConfiguration = {
  active: boolean
  visible: boolean
}

export type WelcomeHUDControllerModel = HUDConfiguration & {
  hasWallet: boolean
}

export type CatalystNode = {
  domain: string
}

export type GraphResponse = {
  nfts: {
    ens: {
      subdomain: string
    }
  }[]
}

export enum ChatMessageType {
  NONE,
  PUBLIC,
  PRIVATE,
  SYSTEM
}

export type WorldPosition = {
  realm: {
    serverName: string
    layer: string
  }
  gridPosition: {
    x: number
    y: number
  }
}

export enum ChatMessagePlayerType {
  WALLET = 0,
  GUEST = 1
}

export type ChatMessage = {
  messageId: string
  messageType: ChatMessageType
  sender?: string | undefined
  recipient?: string | undefined
  timestamp: number
  body: string
}

export type FriendsInitializationMessage = {
  currentFriends: string[]
  requestedTo: string[]
  requestedFrom: string[]
}

export enum FriendshipAction {
  NONE,
  APPROVED,
  REJECTED,
  CANCELED,
  REQUESTED_FROM,
  REQUESTED_TO,
  DELETED
}

export type FriendshipUpdateStatusMessage = {
  userId: string
  action: FriendshipAction
}

export enum PresenceStatus {
  NONE,
  OFFLINE,
  ONLINE,
  UNAVAILABLE
}

type Realm = {
  serverName: string
}

export type UpdateUserStatusMessage = {
  userId: string
  realm: Realm | undefined
  position: Vector2Component | undefined
  presence: PresenceStatus
}

export type BuilderConfiguration = {
  camera: {
    zoomMin: number
    zoomMax: number
    zoomDefault: number
  }
  environment: {
    disableFloor: boolean
  }
}

export type KernelConfigForRenderer = {
  comms: {
    commRadius: number
    voiceChatEnabled: boolean
  }
  profiles: {
    nameValidRegex: string
    nameValidCharacterRegex: string
  }
  debugConfig?: Partial<{
    sceneDebugPanelEnabled?: boolean
    sceneDebugPanelTargetSceneId?: string
    sceneLimitsWarningSceneId?: string
  }>
  gifSupported: boolean
  network: string
  validWorldRanges: Object
  kernelVersion: string
  rendererVersion: string
}

export type RealmsInfoForRenderer = {
  current: CurrentRealmInfoForRenderer
  realms: {
    layer: string
    serverName: string
    url: string
    usersCount: number
    usersMax: number
    userParcels: [number, number][]
  }[]
}

export type CurrentRealmInfoForRenderer = {
  layer: string
  serverName: string
  domain: string
  contentServerUrl: string
}

export type TutorialInitializationMessage = {
  fromDeepLink: boolean
  enableNewTutorialCamera: boolean
}

export type HeaderRequest = {
  endpoint: string
  headers: Record<string, string>
}

export enum AvatarRendererMessageType {
  SCENE_CHANGED = 'SceneChanged',
  REMOVED = 'Removed'
}

export type AvatarRendererBasePayload = {
  avatarShapeId: string
}

export type AvatarRendererPositionMessage = {
  type: AvatarRendererMessageType.SCENE_CHANGED
  sceneId?: string
} & AvatarRendererBasePayload

export type AvatarRendererRemovedMessage = {
  type: AvatarRendererMessageType.REMOVED
} & AvatarRendererBasePayload

export type AvatarRendererMessage = AvatarRendererRemovedMessage | AvatarRendererPositionMessage
