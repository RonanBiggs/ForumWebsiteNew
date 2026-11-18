// computer.js - the desk + chair + computer you sit at. Used in every room
// (to reply) and in the lobby (to start a new thread).
//
// A Station is the "logical" computer: it owns the screen canvas the terminal
// draws on, knows its kind ('reply' or 'thread'), and where the camera sits.
// buildComputerDesk() makes the PLACEHOLDER 3D desk for a station.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { addBox } from './materials.js';

// Positions relative to the desk group. The desk faces +z: you sit on the +z side.
const SEAT = new THREE.Vector3(0, 1.15, 0.67);     // camera when seated
const SCREEN = new THREE.Vector3(0, 1.06, 0.09);   // what the camera looks at

export class Station {
    // kind: 'reply' (room computer) or 'thread' (lobby computer)
    // drawIdle(g, w, h): draws the screen while nobody is sitting there
    constructor({ kind, room = null, drawIdle }) {
        this.kind = kind;
        this.room = room;
        this.drawIdleFn = drawIdle;
        this.desk = null;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1024;
        this.canvas.height = 768;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.drawIdle();
    }

    drawIdle() {
        const g = this.canvas.getContext('2d');
        drawScreenBackground(g, this.canvas.width, this.canvas.height);
        this.drawIdleFn(g, this.canvas.width, this.canvas.height);
        this.texture.needsUpdate = true;
    }

    seatPose() {
        return {
            pos: this.desk.localToWorld(SEAT.clone()),
            look: this.desk.localToWorld(SCREEN.clone()),
        };
    }
}

export function drawScreenBackground(g, w, h) {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, w, h);
}

// Optional .glb computer model, loaded once and shared by every desk.
let modelPromise = null;
function loadComputerModel() {
    if (!CONFIG.COMPUTER_MODEL_URL) return null;
    modelPromise ??= import('three/addons/loaders/GLTFLoader.js')
        .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(CONFIG.COMPUTER_MODEL_URL))
        .catch((err) => {
            console.warn('Computer model failed to load, using placeholder.', err);
            return null;
        });
    return modelPromise;
}

// Builds desk + chair + computer under `parent`, at (x, z) turned by rotY.
// onChange() is called when meshes are added later (async model load).
export function buildComputerDesk(parent, mats, station, { x = 0, z = 0, rotY = 0, onChange = () => {} } = {}) {
    const desk = new THREE.Group();
    desk.position.set(x, 0, z);
    desk.rotation.y = rotY;
    parent.add(desk);
    station.desk = desk;

    addBox(desk, { w: 1.8, h: 0.06, d: 0.8, y: 0.75, mat: mats.furniture, collider: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        addBox(desk, { w: 0.06, h: 0.72, d: 0.06, x: sx * 0.84, y: 0.36, z: sz * 0.34, mat: mats.furniture });
    }
    // chair
    addBox(desk, { w: 0.5, h: 0.06, d: 0.5, y: 0.48, z: 0.95, mat: mats.furniture, collider: true });
    addBox(desk, { w: 0.5, h: 0.55, d: 0.05, y: 0.8, z: 1.18, mat: mats.furniture });
    addBox(desk, { w: 0.06, h: 0.45, d: 0.06, y: 0.225, z: 0.95, mat: mats.dark });

    const pc = new THREE.Group();
    pc.position.set(0, 0.78, -0.15);
    desk.add(pc);

    const tag = (mesh) => { mesh.userData.interact = { type: 'computer', station }; };
    const screenMat = new THREE.MeshBasicMaterial({ map: station.texture, toneMapped: false });

    const placeholder = () => {
        const body = addBox(pc, { w: 0.56, h: 0.46, d: 0.48, y: 0.27, mat: mats.computer });
        addBox(pc, { w: 0.3, h: 0.04, d: 0.3, y: 0.02, mat: mats.computer });
        const bezel = addBox(pc, { w: 0.5, h: 0.4, d: 0.01, y: 0.28, z: 0.24, mat: mats.dark });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), screenMat);
        screen.position.set(0, 0.28, 0.247);
        pc.add(screen);
        addBox(pc, { w: 0.46, h: 0.03, d: 0.16, y: 0.015, z: 0.42, mat: mats.computer });
        [body, bezel, screen].forEach(tag);
        onChange();
    };

    const promise = loadComputerModel();
    if (!promise) {
        placeholder();
    } else {
        promise.then((gltf) => {
            if (!desk.parent) return;                 // desk was rebuilt meanwhile
            if (!gltf) return placeholder();
            const model = gltf.scene.clone(true);
            model.traverse((o) => {
                if (!o.isMesh) return;
                tag(o);
                if (o.name === 'Screen') o.material = screenMat;
            });
            pc.add(model);
            onChange();
        });
    }
    return desk;
}
