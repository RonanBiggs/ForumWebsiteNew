// materials.js - shared PLACEHOLDER materials + a box helper whose textures tile by real size.

import * as THREE from 'three';
import { gridTexture } from './textures.js';

export function createMaterials() {
    const grid = (color, opts = {}) => new THREE.MeshStandardMaterial({ map: gridTexture(color), roughness: 0.9, ...opts });
    return {
        floor: grid('#8c8c8c'),
        wall: grid('#d0d0d0'),
        ceiling: grid('#e6e6e6'),
        door: grid('#a0866a'),
        furniture: grid('#7a6a5a'),
        trim: grid('#555555'),
        computer: grid('#c8c8c0'),
        dark: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }),
        light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5 }),
    };
}

// BoxGeometry whose UVs are in metres / tile, so shared repeating textures
// keep the same scale on every wall no matter how big the box is.
export function scaledBox(w, h, d, tile = 1) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
    for (let f = 0; f < 6; f++) {
        for (let v = 0; v < 4; v++) {
            const i = f * 4 + v;
            uv.setXY(i, (uv.getX(i) * faceDims[f][0]) / tile, (uv.getY(i) * faceDims[f][1]) / tile);
        }
    }
    return geo;
}

// addBox(parent, { w, h, d, x, y, z, mat, tile, collider })
export function addBox(parent, { w, h, d, x = 0, y = 0, z = 0, mat, tile = 1, collider = false }) {
    const mesh = new THREE.Mesh(scaledBox(w, h, d, tile), mat);
    mesh.position.set(x, y, z);
    if (collider) mesh.userData.collider = true;
    parent.add(mesh);
    return mesh;
}

// A flat textured sign. Unlit so text stays readable in dim rooms.
export function addSign(parent, texture, { w, h, x = 0, y = 0, z = 0, rotY = 0 }) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.userData.ownsMaterial = true;
    parent.add(mesh);
    return mesh;
}

// Free GPU memory for everything under `object` (shared materials are left alone).
export function disposeTree(object) {
    object.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        if (o.userData.ownsMaterial) {
            if (!o.userData.keepMap) o.material.map?.dispose();
            o.material.dispose();
        }
    });
}
