import { getOwnerNameFromJsonData, getThumbnailUrlFromJsonDataAndContent } from 'shared/selectors'
import { getFetchContentServer } from 'shared/dao/selectors'
import { fetchScenesByLocation } from 'decentraland-loader/lifecycle/utils/fetchSceneIds'
import { getUnityInstance } from 'unity-interface/IUnityInterface'
import { store } from 'shared/store/isolatedStore'

import { UserActionModuleServiceDefinition } from '../proto/UserActionModule.gen'
import { PortContext } from './context'
import { RpcServerPort } from '@dcl/rpc'
import * as codegen from '@dcl/rpc/dist/codegen'
import { getSceneNameFromAtlasState, postProcessSceneName } from 'shared/atlas/selectors'
import { Scene } from '@dcl/schemas'

export function registerUserActionModuleServiceServerImplementation(port: RpcServerPort<PortContext>) {
  function getSceneName(baseCoord: string, sceneJsonData?: Scene): string {
    const sceneName = getSceneNameFromAtlasState(sceneJsonData) ?? store.getState().atlas.tileToScene[baseCoord]?.name
    return postProcessSceneName(sceneName)
  }

  codegen.registerService(port, UserActionModuleServiceDefinition, async () => ({
    async requestTeleport(req, ctx) {
      const { destination } = req
      if (destination === 'magic' || destination === 'crowd') {
        getUnityInstance().RequestTeleport({ destination })
        return {}
      } else if (!/^\-?\d+\,\-?\d+$/.test(destination)) {
        ctx.logger.error(`teleportTo: invalid destination ${destination}`)
        return {}
      }

      let sceneThumbnailUrl: string | undefined
      let sceneName: string = destination
      let sceneCreator: string = 'Unknown'
      let sceneEvent = {}

      const mapSceneData = (await fetchScenesByLocation([destination]))[0]

      const metadata: Scene | undefined = mapSceneData?.entity.metadata

      sceneName = getSceneName(destination, metadata)
      sceneCreator = getOwnerNameFromJsonData(metadata)

      if (mapSceneData) {
        sceneThumbnailUrl = getThumbnailUrlFromJsonDataAndContent(
          mapSceneData.entity.metadata,
          mapSceneData.entity.content,
          getFetchContentServer(store.getState())
        )
      } else {
        debugger
      }
      if (!sceneThumbnailUrl) {
        let sceneParcels = [destination]
        if (metadata && metadata.scene.parcels) {
          sceneParcels = metadata.scene.parcels
        }
        sceneThumbnailUrl = `https://api.decentraland.org/v1/map.png?width=480&height=237&size=10&center=${destination}&selected=${sceneParcels.join(
          ';'
        )}`
      }

      try {
        const response = await fetch(`https://events.decentraland.org/api/events/?position=${destination}`)
        const json = await response.json()
        if (json.data.length > 0) {
          sceneEvent = {
            name: json.data[0].name,
            total_attendees: json.data[0].total_attendees,
            start_at: json.data[0].start_at,
            finish_at: json.data[0].finish_at
          }
        }
      } catch (e: any) {
        ctx.logger.error(e)
      }

      getUnityInstance().RequestTeleport({
        destination,
        sceneEvent,
        sceneData: {
          name: sceneName,
          owner: sceneCreator,
          previewImageUrl: sceneThumbnailUrl ?? ''
        }
      })
      return {}
    }
  }))
}
