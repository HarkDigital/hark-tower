import * as THREE from 'three'

/*
 * Materials for this chapter's InstancedMeshes. When one material is drawn
 * by both an InstancedMesh and a plain Mesh, three re-resolves its program
 * on every draw (the instancing flag flips), rebuilding the parameter object
 * and the cache key each time. So the kit's shared materials get a private
 * copy here, used only by instances; the plain meshes keep the shared ones.
 * The copies compile to the same programs, so nothing new is compiled.
 */

const copies = new Map<THREE.Material, THREE.Material>()

/** A private copy of a shared kit material, for InstancedMesh use only. */
export function forInstances<M extends THREE.Material>(shared: M): M {
  let copy = copies.get(shared) as M | undefined
  if (!copy) {
    copy = shared.clone() as M
    copies.set(shared, copy)
  }
  return copy
}

let depth: THREE.MeshDepthMaterial | null = null

/**
 * The shadow pass has the same problem: without a customDepthMaterial every
 * caster shares the renderer's single depth material, instanced or not.
 * Instanced casters here use this one instead.
 */
export function instancedDepth(): THREE.MeshDepthMaterial {
  if (!depth) depth = new THREE.MeshDepthMaterial()
  return depth
}
