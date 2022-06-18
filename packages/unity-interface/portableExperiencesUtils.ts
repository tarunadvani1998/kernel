import {
  StorePortableExperience
} from '../shared/types'
import { UnityPortableExperienceScene } from './UnityParcelScene'
import { forceStopSceneWorker, getSceneWorkerBySceneID, loadParcelScene } from 'shared/world/parcelSceneManager'
import { getUnityInstance } from './IUnityInterface'
import { parseUrn, resolveContentUrl } from '@dcl/urn-resolver'
import { Entity } from '@dcl/schemas'
import { store } from 'shared/store/isolatedStore'
import { addScenePortableExperience, removeScenePortableExperience } from 'shared/portableExperiences/actions'
import { sleep } from 'atomicHelpers/sleep'
import { entityToLoadableParcelScene } from '../shared/selectors'

declare let window: any

// TODO: Remove this when portable experiences are full-available
window['spawnScenePortableExperienceSceneFromUrn'] = spawnScenePortableExperienceSceneFromUrn
window['killScenePortableExperience'] = killScenePortableExperience

export type PortableExperienceHandle = {
  pid: string
  parentCid: string
}

const currentPortableExperiences: Map<string, UnityPortableExperienceScene> = new Map()

export async function spawnScenePortableExperienceSceneFromUrn(
  sceneUrn: string,
  parentCid: string
): Promise<PortableExperienceHandle> {
  const data = await getPortableExperienceFromUrn(sceneUrn)

  store.dispatch(addScenePortableExperience(data))

  return {
    parentCid,
    pid: data.entity.id
  }
}

export function killScenePortableExperience(urn: string) {
  store.dispatch(removeScenePortableExperience(urn))
}

export function getRunningPortableExperience(sceneId: string): UnityPortableExperienceScene | undefined {
  return currentPortableExperiences.get(sceneId)
}

export async function getPortableExperienceFromUrn(sceneUrn: string): Promise<StorePortableExperience> {
  const resolvedEntity = await parseUrn(sceneUrn)

  if (resolvedEntity === null || resolvedEntity.type !== 'entity') {
    throw new Error(`Could not resolve mappings for scene: ${sceneUrn}`)
  }

  const resolvedUrl = await resolveContentUrl(resolvedEntity)

  if (!resolvedUrl) {
    throw new Error('Could not resolve URL to download ' + sceneUrn)
  }

  const result = await fetch(resolvedUrl)
  const entity = (await result.json()) as Entity
  const baseUrl: string = resolvedEntity.baseUrl || new URL('.', resolvedUrl).toString()

  return {
    entity: {
      ...entity,
      baseUrl
    },
    parentCid: 'main',
  }
}

export function getPortableExperiencesLoaded() {
  return new Set(currentPortableExperiences.values())
}

/**
 * Kills all portable experiences that are not present in the given list
 */
export async function declareWantedPortableExperiences(pxs: StorePortableExperience[]) {
  const immutableList = new Set(currentPortableExperiences.keys())

  const wantedIds = pxs.map(($) => $.entity.id)

  // kill extra ones
  for (const sceneUrn of immutableList) {
    if (!wantedIds.includes(sceneUrn)) {
      const scene = getRunningPortableExperience(sceneUrn)
      if (scene) {
        currentPortableExperiences.delete(sceneUrn)
        forceStopSceneWorker(scene.worker)
      }
    }
  }

  // TODO: this is an ugh workaround, fix controlling the scene lifecycle
  // knowing when the scene was completly removed and then re-spawn it
  await sleep(250)

  // then load all the missing scenes
  for (const sceneData of pxs) {
    if (!getRunningPortableExperience(sceneData.entity.id)) {
      spawnPortableExperience(sceneData)
    }
  }
}

function spawnPortableExperience(spawnData: StorePortableExperience): PortableExperienceHandle {
  if (currentPortableExperiences.has(spawnData.entity.id) || getSceneWorkerBySceneID(spawnData.entity.id)) {
    throw new Error(`Portable Experience: "${spawnData.entity.id}" is already running.`)
  }

  const data = entityToLoadableParcelScene(spawnData.entity)
  data.useFPSThrottling = false

  const scene = new UnityPortableExperienceScene(data, spawnData.parentCid)
  currentPortableExperiences.set(scene.data.sceneId, scene)
  loadParcelScene(scene, undefined, true)
  getUnityInstance().CreateGlobalScene({
    id: scene.data.sceneId,
    name: scene.data.name,
    baseUrl: scene.data.baseUrl,
    contents: scene.data.data.contents,
    icon: spawnData.entity.metadata.menuBarIcon,
    isPortableExperience: true
  })

  return { pid: scene.data.sceneId, parentCid: spawnData.parentCid }
}
