/**
 * Low-poly canopy frame and dash attached to the camera. Shared by space
 * flight and the launch-ascent cinematic.
 */

import * as THREE from "three";

export function buildCockpit(): THREE.Group {
  const cockpit = new THREE.Group();
  const frameMaterial = new THREE.MeshBasicMaterial({
    color: "#0a1216",
  });
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: "#123c33",
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: "#7df0cf",
  });

  const dash = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.42, 0.5),
    frameMaterial,
  );
  dash.position.set(0, -0.86, -1.05);
  dash.rotation.x = 0.5;

  const dashStrip = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.05, 0.06),
    glowMaterial,
  );
  dashStrip.position.set(0, -0.7, -1.02);
  dashStrip.rotation.x = 0.5;

  const strut = (
    x: number,
    tilt: number,
  ): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.4, 0.08),
      frameMaterial,
    );
    mesh.position.set(x, 0.16, -1.18);
    mesh.rotation.z = tilt;
    return mesh;
  };

  const topBar = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 0.09, 0.09),
    frameMaterial,
  );
  topBar.position.set(0, 1.02, -1.14);

  const sidePanelLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.3),
    stripMaterial,
  );
  sidePanelLeft.position.set(-1.15, -0.62, -1);
  sidePanelLeft.rotation.y = 0.5;
  const sidePanelRight = sidePanelLeft.clone();
  sidePanelRight.position.x = 1.15;
  sidePanelRight.rotation.y = -0.5;

  cockpit.add(
    dash,
    dashStrip,
    strut(-1.28, 0.32),
    strut(1.28, -0.32),
    topBar,
    sidePanelLeft,
    sidePanelRight,
  );
  return cockpit;
}
