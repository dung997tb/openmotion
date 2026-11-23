/** Repair only the known catalog defect; leave other material settings untouched. */
export function repairCodeExtrudeMaterial(source: string): string {
  return source.replace(`          var edgeMat = new THREE.MeshStandardMaterial({
            color: 0x141d2b,
            roughness: 0.3,
            metalness: 0.4,
          });
`, `          // Keep the lit bevel independent of fragment-derivative extensions,
          // including when a backgrounded preview rebuilds its WebGL resources.
          var edgeMat = new THREE.MeshPhongMaterial({
            color: 0x141d2b,
            specular: 0x536479,
            shininess: 30,
          });
`);
}

/** Remove the catalog demo backdrop when placing a stock overlay on another composition. */
export function componentOverlaySource(source: string): string {
  return source.replace(/background:\s*(?:#(?:0a0a0a|000000|000|0a0805)|rgba?\([^)]*\))\s*;/g, 'background: transparent;');
}
