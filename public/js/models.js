// models.js - loads uploaded 3D models (GLB / glTF, OBJ, STL, FBX) for model replies,
// and room scans (the same formats plus PLY) from apps like Polycam and Scaniverse.
//
// The server says which format a file is through its Content-Type (model/gltf-binary,
// model/gltf+json, model/obj, model/stl, model/fbx). Loaders are only downloaded
// the first time a model of that format is shown.
// The result is centred and scaled to fit in a `size` metre box, like the image shapes.

import * as THREE from 'three';

export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.fbx'];

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/';
const plain = () => new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.6, metalness: 0.1 });

async function gltfLoader() {
    const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
    ]);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath(THREE_CDN + 'libs/draco/gltf/'));   // compressed models
    loader.setMeshoptDecoder(MeshoptDecoder);
    return loader;
}

// -> { object: THREE.Object3D, animations: AnimationClip[] }
async function parse(buffer, type) {
    if (type.includes('gltf')) {
        const loader = await gltfLoader();
        const gltf = await loader.parseAsync(buffer, '');
        return { object: gltf.scene, animations: gltf.animations };
    }
    if (type.includes('fbx')) {
        const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
        const object = new FBXLoader().parse(buffer, '');
        return { object, animations: object.animations || [] };
    }
    if (type.includes('stl')) {
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
        const geometry = new STLLoader().parse(buffer);
        const material = geometry.hasColors
            ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
            : plain();
        return { object: new THREE.Mesh(geometry, material), animations: [] };
    }
    if (type.includes('ply')) {
        const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
        const geometry = new PLYLoader().parse(buffer);
        const colors = !!geometry.attributes.color;
        if (geometry.index) {                    // a mesh
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            const material = colors ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }) : plain();
            return { object: new THREE.Mesh(geometry, material), animations: [] };
        }
        // a point cloud (or a gaussian-splat .ply, shown as its points)
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.02, vertexColors: colors, color: colors ? 0xffffff : 0xcccccc }));
        return { object: points, animations: [] };
    }
    if (type.includes('obj')) {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const object = new OBJLoader().parse(new TextDecoder().decode(buffer));
        // OBJ files come without their .mtl here: give everything a plain grey look
        object.traverse((o) => { if (o.isMesh) o.material = plain(); });
        return { object, animations: [] };
    }
    throw new Error(`Unknown 3D model type "${type}"`);
}

// A room scan, as is (real size, not moved). Scans have the light baked into their
// colours, so they're shown unlit, and from both sides (scanned from inside a room).
export async function loadScan(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { object } = await parse(await res.arrayBuffer(), res.headers.get('content-type') || '');
    object.traverse((o) => {
        if (!o.isMesh) return;
        const colours = !!o.geometry.attributes.color;
        o.material = [].concat(o.material).map((m) => {
            if (!m.map && !colours) {                // no photo colours: keep it shaded so its shape shows
                m.side = THREE.DoubleSide;
                return m;
            }
            return new THREE.MeshBasicMaterial({
                map: m.map || null, vertexColors: colours, side: THREE.DoubleSide,
                transparent: m.transparent, alphaTest: m.alphaTest,
            });
        });
        if (o.material.length === 1) o.material = o.material[0];
    });
    return object;
}

// Loads the model at `url` and fits it into a box `size` metres across, centred on (0,0,0).
export async function loadModel(url, size) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    const { object, animations } = await parse(await res.arrayBuffer(), type);

    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const dims = box.getSize(new THREE.Vector3());
    const biggest = Math.max(dims.x, dims.y, dims.z) || 1;
    const holder = new THREE.Group();            // centre + scale without touching the model's own transform
    holder.add(object);
    object.position.sub(box.getCenter(new THREE.Vector3()));
    holder.scale.setScalar(size / biggest);

    holder.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.ownsMaterial = true;          // freed when the room is rebuilt (materials.js disposeTree)
        o.frustumCulled = false;                 // skinned/animated meshes can have stale bounds
    });
    return { object: holder, animations };
}
