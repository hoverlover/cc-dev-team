import { createFlyClient } from './client'
import { createAdminClient } from '../../db/supabase'

const DEFAULT_VOLUME_SIZE_GB = 10
const DEFAULT_REGION = 'iad'

/**
 * Ensure a Fly volume exists for the given project.
 * Reuses existing volume from project.fly_volume_id if valid,
 * otherwise creates a new one.
 */
export async function ensureVolume(projectId: string, _tenantId: string): Promise<string> {
  const supabase = createAdminClient()
  const flyClient = createFlyClient()

  // Check if project already has a volume
  const { data: projects } = await supabase
    .from('projects')
    .select('id, fly_volume_id')
    .eq('id', projectId)

  const project = projects?.[0]
  const existingVolumeId = project?.fly_volume_id

  // Try to reuse existing volume
  if (existingVolumeId) {
    try {
      await flyClient.getVolume(existingVolumeId)
      return existingVolumeId
    } catch {
      // Volume no longer exists, create a new one
    }
  }

  // Create new volume
  const shortId = projectId.substring(0, 8)
  const volume = await flyClient.createVolume({
    name: `cdt-vol-${shortId}`,
    size_gb: DEFAULT_VOLUME_SIZE_GB,
    region: DEFAULT_REGION,
  })

  // Store volume ID in project
  await supabase
    .from('projects')
    .update({ fly_volume_id: volume.id })
    .eq('id', projectId)

  return volume.id
}
