import { WorldInstanceConnection } from '../interface/index'
import { Stats } from '../debug'
import {
  Package,
  BusMessage,
  ChatMessage,
  ProfileVersion,
  UserInformation,
  PackageType,
  VoiceFragment,
  ProfileResponse,
  ProfileRequest
} from '../interface/types'
import { Position, positionHash } from '../interface/utils'
import defaultLogger, { createLogger } from 'shared/logger'
import { PeerMessageTypes, PeerMessageType } from 'decentraland-katalyst-peer/src/messageTypes'
import {
  Peer as IslandBasedPeer,
  buildCatalystPeerStatsData,
  PeerConfig,
  PacketCallback,
  PeerStatus
} from '@dcl/catalyst-peer'
import type { Room } from 'decentraland-katalyst-peer/src/types'
import {
  ChatData,
  CommsMessage,
  ProfileData,
  SceneData,
  PositionData,
  VoiceData,
  ProfileRequestData,
  ProfileResponseData
} from './proto/comms_pb'
import { Realm, CommsStatus } from 'shared/dao/types'
import { compareVersions } from 'atomicHelpers/semverCompare'

import { getProfileType } from 'shared/profiles/getProfileType'
import { Profile } from 'shared/types'
import { ProfileType } from 'shared/profiles/types'
import { EncodedFrame } from 'voice-chat-codec/types'

type PeerType = IslandBasedPeer

const NOOP = () => {
  // do nothing
}

const logger = createLogger('Lighthouse: ')

type MessageData =
  | ChatData
  | ProfileData
  | SceneData
  | PositionData
  | VoiceData
  | ProfileRequestData
  | ProfileResponseData

export type LighthouseConnectionConfig = PeerConfig & {
  preferedIslandId?: string
}

const commsMessageType: PeerMessageType = {
  name: 'sceneComms',
  ttl: 10,
  expirationTime: 10 * 1000,
  optimistic: true
}

const VoiceType: PeerMessageType = {
  name: 'voice',
  ttl: 5,
  optimistic: true,
  discardOlderThan: 2000,
  expirationTime: 10000
}

function ProfileRequestResponseType(action: 'request' | 'response'): PeerMessageType {
  return {
    name: 'profile_' + action,
    ttl: 10,
    optimistic: true,
    discardOlderThan: 0,
    expirationTime: 10000
  }
}

export class LighthouseWorldInstanceConnection implements WorldInstanceConnection {
  stats: Stats | null = null

  sceneMessageHandler: (data: Package<BusMessage>) => void = NOOP
  chatHandler: (data: Package<ChatMessage>) => void = NOOP
  profileHandler: (data: Package<ProfileVersion>) => void = NOOP
  positionHandler: (data: Package<Position>) => void = NOOP
  voiceHandler: (data: Package<VoiceFragment>) => void = NOOP
  profileResponseHandler: (data: Package<ProfileResponse>) => void = NOOP
  profileRequestHandler: (data: Package<ProfileRequest>) => void = NOOP

  ping: number = -1

  private peer: PeerType

  private rooms: string[] = []

  constructor(
    private peerId: string,
    private realm: Realm,
    private lighthouseUrl: string,
    private peerConfig: LighthouseConnectionConfig,
    private statusHandler: (status: CommsStatus) => void
  ) {
    // This assignment is to "definetly initialize" peer
    this.peer = this.initializePeer()
  }

  async connect() {
    try {
      if (!this.peer.connectedCount()) {
        await this.peer.awaitConnectionEstablished(60000)
      }
      this.statusHandler({ status: 'connected', connectedPeers: this.connectedPeersCount() })
      return true
    } catch (e) {
      defaultLogger.error('Error while connecting to layer', e)
      this.statusHandler({
        status: e.responseJson && e.responseJson.status === 'layer_is_full' ? 'realm-full' : 'error',
        connectedPeers: this.connectedPeersCount()
      })
      throw e
    }
  }

  public async changeRealm(realm: Realm, url: string) {
    this.statusHandler({ status: 'connecting', connectedPeers: this.connectedPeersCount() })
    if (this.peer) {
      await this.cleanUpPeer()
    }

    this.realm = realm
    this.lighthouseUrl = url
    this.peerConfig.eventsHandler?.onIslandChange?.(undefined, [])

    this.initializePeer()
    await this.connect()
    await this.syncRoomsWithPeer()
  }

  disconnect() {
    return this.cleanUpPeer()
  }

  analyticsData() {
    return {
      // This should work for any of both peer library types. Once we stop using both, we can remove the type cast
      // tslint:disable-next-line
      stats: buildCatalystPeerStatsData(this.peer as any)
    }
  }

  async sendInitialMessage(userInfo: Partial<UserInformation>) {
    const topic = userInfo.userId!

    await this.sendProfileData(userInfo, topic, 'initialProfile')
  }

  async sendProfileMessage(currentPosition: Position, userInfo: UserInformation) {
    const topic = positionHash(currentPosition)

    await this.sendProfileData(userInfo, topic, 'profile')
  }

  async sendProfileRequest(currentPosition: Position, userId: string, version: number | undefined): Promise<void> {
    const topic = positionHash(currentPosition)

    const profileRequestData = new ProfileRequestData()
    profileRequestData.setUserId(userId)
    profileRequestData.setProfileVersion(version?.toString() ?? '')

    await this.sendData(topic, profileRequestData, ProfileRequestResponseType('request'))
  }

  async sendProfileResponse(currentPosition: Position, profile: Profile): Promise<void> {
    const topic = positionHash(currentPosition)

    const profileResponseData = new ProfileResponseData()
    profileResponseData.setSerializedProfile(JSON.stringify(profile))

    await this.sendData(topic, profileResponseData, ProfileRequestResponseType('response'))
  }

  async sendPositionMessage(p: Position) {
    const topic = positionHash(p)

    await this.sendPositionData(p, topic, 'position')
  }

  async sendParcelUpdateMessage(currentPosition: Position, p: Position) {
    const topic = positionHash(currentPosition)

    await this.sendPositionData(p, topic, 'parcelUpdate')
  }

  async sendParcelSceneCommsMessage(sceneId: string, message: string) {
    const topic = sceneId

    const sceneData = new SceneData()
    sceneData.setSceneId(sceneId)
    sceneData.setText(message)

    await this.sendData(topic, sceneData, commsMessageType)
  }

  async sendVoiceMessage(currentPosition: Position, frame: EncodedFrame): Promise<void> {
    const topic = positionHash(currentPosition)

    const voiceData = new VoiceData()
    voiceData.setEncodedSamples(frame.encoded)
    voiceData.setIndex(frame.index)

    await this.sendData(topic, voiceData, VoiceType)
  }

  async sendChatMessage(currentPosition: Position, messageId: string, text: string) {
    const topic = positionHash(currentPosition)

    const chatMessage = new ChatData()
    chatMessage.setMessageId(messageId)
    chatMessage.setText(text)

    await this.sendData(topic, chatMessage, PeerMessageTypes.reliable('chat'))
  }

  async setTopics(rooms: string[]) {
    this.rooms = rooms
    await this.syncRoomsWithPeer()
  }

  private async syncRoomsWithPeer() {
    const currentRooms = [...this.peer.currentRooms]

    function isSameRoom(roomId: string, roomIdOrObject: string | Room) {
      return roomIdOrObject === roomId || (typeof roomIdOrObject !== 'string' && roomIdOrObject.id === roomId)
    }

    const joining = this.rooms.map((room) => {
      if (!currentRooms.some((current) => isSameRoom(room, current))) {
        return this.peer.joinRoom(room)
      } else {
        return Promise.resolve()
      }
    })
    const leaving = currentRooms.map(async (current) => {
      if (!this.rooms.some((room) => isSameRoom(room, current))) {
        if (typeof (current as any) === 'string') {
          return this.peer.leaveRoom(current)
        }
      }
    })
    return Promise.all([...joining, ...leaving])
  }

  private async sendData(topic: string, messageData: MessageData, type: PeerMessageType) {
    try {
      await this.peer.sendMessage(topic, createCommsMessage(messageData).serializeBinary(), type)
    } catch (e) {
      const message = e.message
      if (typeof message === 'string' && message.startsWith('cannot send a message in a room not joined')) {
        // We can ignore this error. This is usually just a problem of eventual consistency.
        // And when it is not, it is usually caused by another error that we might find above. Effectively, we are just making noise.
      } else {
        throw e
      }
    }
  }

  private async sendPositionData(p: Position, topic: string, typeName: string) {
    const positionData = createPositionData(p)
    await this.sendData(topic, positionData, PeerMessageTypes.unreliable(typeName))
  }

  private async sendProfileData(userInfo: UserInformation, topic: string, typeName: string) {
    const profileData = createProfileData(userInfo)
    await this.sendData(topic, profileData, PeerMessageTypes.unreliable(typeName))
  }

  private initializePeer() {
    this.statusHandler({ status: 'connecting', connectedPeers: this.connectedPeersCount() })
    this.peer = this.createPeer()
    ;(globalThis as any).__DEBUG_PEER = this.peer

    if (this.peerConfig.preferedIslandId && 'setPreferedIslandId' in this.peer) {
      this.peer.setPreferedIslandId(this.peerConfig.preferedIslandId)
    }

    return this.peer
  }

  private connectedPeersCount(): number {
    return this.peer ? this.peer.connectedCount() : 0
  }

  private createPeer(): PeerType {
    const statusHandler = (status: PeerStatus): void =>
      this.statusHandler({ status, connectedPeers: this.connectedPeersCount() })

    // Island based peer based peer
    if (this.peerConfig.eventsHandler) {
      this.peerConfig.eventsHandler.statusHandler = statusHandler
    } else {
      this.peerConfig.eventsHandler = {
        statusHandler
      }
    }

    // We require a version greater than 0.1 to not send an ID
    const idToUse = compareVersions('0.1', this.realm.lighthouseVersion) === -1 ? undefined : this.peerId

    return new IslandBasedPeer(this.lighthouseUrl, idToUse, this.peerCallback, this.peerConfig)
  }

  private async cleanUpPeer() {
    return this.peer.dispose()
  }

  private peerCallback: PacketCallback = (sender, room, payload, packet) => {
    try {
      const commsMessage = CommsMessage.deserializeBinary(payload)
      switch (commsMessage.getDataCase()) {
        case CommsMessage.DataCase.CHAT_DATA:
          this.chatHandler(createPackage(sender, commsMessage, 'chat', mapToPackageChat(commsMessage.getChatData()!)))
          break
        case CommsMessage.DataCase.POSITION_DATA:
          const positionMessage = mapToPositionMessage(commsMessage.getPositionData()!)
          this.peer.setPeerPosition(sender, positionMessage.slice(0, 3) as [number, number, number])
          this.positionHandler(createPackage(sender, commsMessage, 'position', positionMessage))
          break
        case CommsMessage.DataCase.SCENE_DATA:
          this.sceneMessageHandler(
            createPackage(sender, commsMessage, 'chat', mapToPackageScene(commsMessage.getSceneData()!))
          )
          break
        case CommsMessage.DataCase.PROFILE_DATA:
          this.profileHandler(
            createPackage(sender, commsMessage, 'profile', mapToPackageProfile(commsMessage.getProfileData()!))
          )
          break
        case CommsMessage.DataCase.VOICE_DATA:
          this.voiceHandler(
            createPackage(
              sender,
              commsMessage,
              'voice',
              mapToPackageVoice(
                commsMessage.getVoiceData()!.getEncodedSamples_asU8(),
                commsMessage.getVoiceData()!.getIndex(),
                packet.sequenceId
              )
            )
          )
          break
        case CommsMessage.DataCase.PROFILE_REQUEST_DATA:
          this.profileRequestHandler(
            createPackage(
              sender,
              commsMessage,
              'profileRequest',
              mapToPackageProfileRequest(commsMessage.getProfileRequestData()!)
            )
          )
          break
        case CommsMessage.DataCase.PROFILE_RESPONSE_DATA:
          this.profileResponseHandler(
            createPackage(
              sender,
              commsMessage,
              'profileResponse',
              mapToPackageProfileResponse(commsMessage.getProfileResponseData()!)
            )
          )
          break
        default: {
          logger.warn(`message with unknown type received ${commsMessage.getDataCase()}`)
          break
        }
      }
    } catch (e) {
      logger.error(`Error processing received message from ${sender}. Topic: ${room}`, e)
    }
  }
}

function createPackage<T>(sender: string, commsMessage: CommsMessage, type: PackageType, data: T): Package<T> {
  return {
    sender,
    time: commsMessage.getTime(),
    type,
    data
  }
}

function mapToPositionMessage(positionData: PositionData): Position {
  return [
    positionData.getPositionX(),
    positionData.getPositionY(),
    positionData.getPositionZ(),
    positionData.getRotationX(),
    positionData.getRotationY(),
    positionData.getRotationZ(),
    positionData.getRotationW(),
    positionData.getImmediate()
  ]
}

function mapToPackageChat(chatData: ChatData) {
  return {
    id: chatData.getMessageId(),
    text: chatData.getText()
  }
}

function mapToPackageScene(sceneData: SceneData) {
  return {
    id: sceneData.getSceneId(),
    text: sceneData.getText()
  }
}

function mapToPackageProfile(profileData: ProfileData) {
  return {
    user: profileData.getUserId(),
    version: profileData.getProfileVersion(),
    type: mapToPackageProfileType(profileData.getProfileType())
  }
}

function mapToPackageProfileType(profileType: ProfileType) {
  return profileType === ProfileData.ProfileType.LOCAL ? ProfileType.LOCAL : ProfileType.DEPLOYED
}

function mapToPackageProfileRequest(profileRequestData: ProfileRequestData) {
  const versionData = profileRequestData.getProfileVersion()
  return {
    userId: profileRequestData.getUserId(),
    version: versionData !== '' ? versionData : undefined
  }
}

function mapToPackageProfileResponse(profileResponseData: ProfileResponseData) {
  return {
    profile: JSON.parse(profileResponseData.getSerializedProfile()) as Profile
  }
}

function mapToPackageVoice(encoded: Uint8Array, index: number, fallbackIndex: number) {
  // If we receive a packet from an old implementation of voice chat, we use the fallbackIndex
  return { encoded, index: index === 0 ? fallbackIndex : index }
}

function createProfileData(userInfo: UserInformation) {
  const profileData = new ProfileData()
  profileData.setProfileVersion(userInfo.version ? userInfo.version.toString() : '')
  profileData.setUserId(userInfo.userId ? userInfo.userId : '')
  profileData.setProfileType(getProtobufProfileType(getProfileType(userInfo.identity)))
  return profileData
}

function getProtobufProfileType(profileType: ProfileType) {
  return profileType === ProfileType.LOCAL ? ProfileData.ProfileType.LOCAL : ProfileData.ProfileType.DEPLOYED
}

function createPositionData(p: Position) {
  const positionData = new PositionData()
  positionData.setPositionX(p[0])
  positionData.setPositionY(p[1])
  positionData.setPositionZ(p[2])
  positionData.setRotationX(p[3])
  positionData.setRotationY(p[4])
  positionData.setRotationZ(p[5])
  positionData.setRotationW(p[6])
  positionData.setImmediate(p[7])
  return positionData
}

function createCommsMessage(data: MessageData) {
  const commsMessage = new CommsMessage()
  commsMessage.setTime(Date.now())

  if (data instanceof ChatData) commsMessage.setChatData(data)
  if (data instanceof SceneData) commsMessage.setSceneData(data)
  if (data instanceof ProfileData) commsMessage.setProfileData(data)
  if (data instanceof PositionData) commsMessage.setPositionData(data)
  if (data instanceof VoiceData) commsMessage.setVoiceData(data)
  if (data instanceof ProfileRequestData) commsMessage.setProfileRequestData(data)
  if (data instanceof ProfileResponseData) commsMessage.setProfileResponseData(data)

  return commsMessage
}
