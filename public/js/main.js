// main.js - sets up three.js, the start screen, and the game states:
//   start -> playing <-> free    (desktop: mouse released, e.g. by the browser on Esc; click the view to carry on)
//                    <-> overlay (reading a reply in full)
//                    <-> seated  (typing at a computer: reply in a room, new thread in the lobby)
//                    <-> inspect (looking at an image cube, drag to turn it)
//
// The start screen's content comes from entrance.html (see loadEntrance below).
// On touch screens (touch.js) there's no pointer lock: on-screen buttons and drag-to-look instead.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { api } from './api.js';
import { createMaterials } from './materials.js';
import { Hotel } from './hotel.js';
import { Player } from './player.js';
import { Terminal } from './terminal.js';
import { Multiplayer } from './net.js';
import { Gun, knockVelocity } from './gun.js';
import { TouchControls, isTouchDevice } from './touch.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- entrance screen
// Puts the contents of public/entrance.html into the start screen. Its <style>
// tags come along too. If it's missing or has no Enter button, the fallback
// inside <div id="start"> in index.html stays.
async function loadEntrance() {
    try {
        const res = await fetch('entrance.html', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        if (!doc.getElementById('enter-btn')) throw new Error('entrance.html needs a <button id="enter-btn">');
        doc.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => document.head.append(el));
        doc.querySelectorAll('script').forEach((el) => el.remove());
        $('start').replaceChildren(...doc.body.childNodes);
    } catch (err) {
        console.warn('Using the built-in start screen:', err.message);
    }
}
const touch = isTouchDevice();
document.body.classList.toggle('touch', touch);
await loadEntrance();
const ui = {
    start: $('start'), enter: $('enter-btn'),
    hud: $('hud'), prompt: $('prompt'), roomLabel: $('room-label'), toast: $('toast'),
    reader: $('reader'), readerPoster: $('reader-poster'), readerDate: $('reader-date'),
    readerBody: $('reader-body'), readerClose: $('reader-close'),
    inspectbar: $('inspectbar'),
    inspectBack: $('inspect-back'),
};
document.title = CONFIG.HOTEL_NAME;

// ---------------------------------------------------------------- three.js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.localClippingEnabled = true;          // room scans are cut away by the door (room.js)
$('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
scene.fog = new THREE.Fog(0x111111, 12, 45);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, CONFIG.EYE_HEIGHT, 4.5);   // lobby, facing down the corridor

// The 3D view fills the VISIBLE part of the page: on phones, when the keyboard is open,
// that's only the part above it, so the whole computer screen stays in view.
function fitView() {
    const vv = window.visualViewport;
    const w = vv ? Math.round(vv.width) : innerWidth;
    const h = vv ? Math.round(vv.height) : innerHeight;
    const view = $('viewport');
    view.style.top = vv ? `${Math.round(vv.offsetTop)}px` : '0';
    view.style.height = `${h}px`;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
}
addEventListener('resize', fitView);
window.visualViewport?.addEventListener('resize', fitView);
window.visualViewport?.addEventListener('scroll', fitView);

const hotel = new Hotel(scene, createMaterials(), api);
const player = new Player(camera, renderer.domElement);
let net = null;     // multiplayer, only when connected to the real server
const gun = new Gun({ scene, camera, hotel, getNet: () => net });
const terminal = new Terminal({
    input: $('term-input'),
    fileInput: $('file-input'),
    scanInput: $('scan-input'),
    api,
    onExit: standUp,
    onThreadCreated: (thread) => { hotel.addRoom(thread, false); requestLayout(); },
});

// ---------------------------------------------------------------- state
let state = 'start';
const show = (el, on = true) => el.classList.toggle('hidden', !on);

// Desktop: capture the mouse (the 'lock' event then starts playing).
// Touch: there's no mouse to capture, so just start playing.
function lockPointer() {
    if (touch) return startPlaying();
    try {
        const p = renderer.domElement.requestPointerLock();
        p?.catch?.(() => {});          // e.g. re-locking too soon after Esc: clicking the view retries
    } catch { /* same */ }
}

function startPlaying() {
    state = 'playing';
    player.enabled = true;
    [ui.reader, ui.start].forEach((el) => show(el, false));
    show(ui.hud);
}
// After closing something (reader, computer, cube): straight back to walking.
// (Desktop: if the browser refuses to capture the mouse right now, a click on the view does it.)
function backToPlaying() {
    state = 'free';
    lockPointer();
}

player.controls.addEventListener('lock', startPlaying);
player.controls.addEventListener('unlock', () => {
    player.enabled = false;
    // The browser always releases the mouse on Esc. No pause menu: clicking the view carries on.
    if (state === 'playing') state = 'free';
});

function enterHotel() {
    document.body.classList.add('entered');     // shows the jester (style.css)
    show(ui.start, false);
    show(ui.hud);
    lockPointer();
}

// ---------------------------------------------------------------- username box (entrance.html)
// One name per IP, saved forever on the first visit, then shown (read-only) on later visits.
// It's shown above your pill to other players. Nobody is told that, on purpose.
const nameInput = $('name-input');
const nameError = $('name-error');
let nameLocked = false;

function lockName(name) {
    nameLocked = true;
    nameInput.value = name;
    nameInput.readOnly = true;
    nameInput.removeAttribute('placeholder');
}

async function loadMyName() {
    if (!nameInput) return;
    try {
        const name = await api.getMyName();
        if (name) lockName(name);
    } catch (err) { console.warn('Could not load username:', err.message); }
}

let entering = false;
async function onEnterClick() {
    if (ui.enter.disabled || entering) return;
    if (!nameInput || nameLocked) return enterHotel();
    const name = nameInput.value.trim();
    if (!name) {
        if (nameError) nameError.textContent = 'Write something here';
        nameInput.focus();
        return;
    }
    entering = true;
    try {
        lockName(await api.setMyName(name));
        if (nameError) nameError.textContent = '';
        enterHotel();
    } catch (err) {
        if (nameError) nameError.textContent = err.message;
    } finally {
        entering = false;
    }
}
ui.enter.addEventListener('click', onEnterClick);
nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnterClick(); } });
nameInput?.addEventListener('input', () => { if (nameError) nameError.textContent = ''; });

const touchControls = touch ? new TouchControls({
    camera, player,
    onFire: () => { if (state === 'playing') gun.fire(); },
    onUse: interact,
}) : null;

let toastTimer;
function toast(msg, ms = 3500) {
    ui.toast.textContent = msg;
    show(ui.toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(ui.toast, false), ms);
}

function openOverlay(el) {
    state = 'overlay';
    player.enabled = false;
    show(ui.prompt, false);
    document.exitPointerLock();
    show(el);
}

// ---------------------------------------------------------------- interaction
const raycaster = new THREE.Raycaster();
raycaster.far = 2.6;
const CENTER = new THREE.Vector2(0, 0);
let target = null;


function findTarget() {
    raycaster.setFromCamera(CENTER, camera);
    const hit = raycaster.intersectObjects(hotel.interactables(), false)[0];
    return hit ? hit.object.userData.interact : null;
}

function interact() {
    if (state !== 'playing' || !target) return;
    if (target.type === 'computer') sitDown(target.station);
    if (target.type === 'reply') openReader(target.reply);
    if (target.type === 'image') inspect(target.room, target.cube);
    if (target.type === 'picture') changePicture(target.slot);
    if (target.type === 'lever') pullLever();
}

// ---------------------------------------------------------------- the lobby lever
// Flips it and asks the server for a random uploaded image / .obj in every frame.
// The result comes back to us AND to everyone else (live), each applied once by its id.
const shufflesSeen = new Set();
let pulling = false;
async function pullLever() {
    if (pulling) return;
    pulling = true;
    hotel.flipLever();
    try {
        applyShuffle(await api.shufflePictures(hotel.frameSlots()), true);
    } catch (err) {
        toast(err.message);
        hotel.flipLever();                          // didn't work: flip it back
    } finally {
        pulling = false;
    }
}
function applyShuffle(msg, mine = false) {
    if (shufflesSeen.has(msg.id)) return;
    shufflesSeen.add(msg.id);
    if (!mine && !pulling) hotel.flipLever();       // someone else pulled it: ours moves too
                                                    // (while we're pulling, this is our own one arriving first)
    hotel.startSlots(msg.pictures);
}

// ---------------------------------------------------------------- changing a lobby/corridor picture
// E at a picture frame: pick an image, it replaces that picture for everyone.
const pictureInput = $('picture-input');
let pictureSlot = null;
function changePicture(slot) {
    pictureSlot = slot;
    pictureInput.click();
}
pictureInput.addEventListener('change', async () => {
    const file = pictureInput.files[0];
    pictureInput.value = '';
    if (!file || !pictureSlot) return;
    try {
        const { slot, url } = await api.setWallImage(pictureSlot, file);
        hotel.setWallImage(slot, url);
    } catch (err) {
        toast(err.message);
    }
});
// One keydown handler, so the same E press can't both start and end something.
addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat) {
        if (state === 'playing') interact();
        else if (state === 'inspect') endInspect();
    } else if (e.code === 'KeyF' && state === 'playing') {
        gun.fire();                                 // key repeat on purpose: hold F to spray
    } else if (e.key === 'Escape') {
        if (state === 'overlay') closeOverlay();
        else if (state === 'inspect') endInspect();
        else if (state === 'seated') standUp();     // works even if the typing box lost focus
    } else if (state === 'seated' && !tween && document.activeElement !== terminal.input) {
        terminal.focus();                           // focus moved away (e.g. clicked a button): grab it back
    }
});
renderer.domElement.addEventListener('mousedown', (e) => {
    if (state === 'playing' && e.button === 0) gun.fire();      // no ammo, no cooldown
    else if (state === 'free') lockPointer();
    else if (state === 'seated' && !tween) {
        clickScreen(e);
        terminal.focus();
    }
});

// Phones at a computer: a tap on the screen must NOT take focus away from the typing box
// (that closes the keyboard), so the touch's default is cancelled and the tap handled here.
// The keyboard is (re)opened on the finger's release: phones only open it for a real tap.
renderer.domElement.addEventListener('pointerdown', (e) => {
    if (state !== 'seated' || e.pointerType === 'mouse') return;
    e.preventDefault();
    if (!tween) clickScreen(e);
});
renderer.domElement.addEventListener('pointerup', (e) => {
    if (state === 'seated' && e.pointerType !== 'mouse' && !tween) terminal.focus();
});
$('seat-exit').addEventListener('click', () => standUp());
$('seat-keyboard').addEventListener('click', () => terminal.focus());

// Sitting at a computer: a click on its screen picks a field / presses POST.
const mouseNdc = new THREE.Vector2();
const screenRay = new THREE.Raycaster();
function clickScreen(e) {
    const screen = terminal.station?.screen;
    if (!screen) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    screenRay.setFromCamera(mouseNdc, camera);
    const hit = screenRay.intersectObject(screen, false)[0];
    if (!hit?.uv) return;
    const { width, height } = terminal.station.canvas;
    terminal.clickAt(hit.uv.x * width, (1 - hit.uv.y) * height);
}

// reading a reply in full
function openReader(reply) {
    ui.readerPoster.textContent = `No. ${reply.session_id}`;
    ui.readerDate.textContent = reply.post_date || '';
    ui.readerBody.replaceChildren();
    if (Number(reply.image) === 1) {
        const img = document.createElement('img');
        img.src = reply.post_content;
        img.alt = 'Image reply';
        ui.readerBody.append(img);
    } else {
        ui.readerBody.textContent = reply.post_content;   // textContent = no HTML injection
    }
    openOverlay(ui.reader);
}
ui.readerClose.addEventListener('click', lockPointer);

// Esc on an overlay: close it
function closeOverlay() {
    show(ui.reader, false);
    backToPlaying();
}

// ---------------------------------------------------------------- sitting at a computer
let tween = null;
let standingPose = null;

function tweenCamera(toPos, toQuat, duration, done) {
    tween = { fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(), toPos, toQuat, t: 0, duration, done };
}

// Camera rotation that looks from `pos` at `look`.
function lookQuat(pos, look) {
    const m = new THREE.Matrix4().lookAt(pos, look, camera.up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
}

function sitDown(station) {
    state = 'seated';
    player.enabled = false;
    player.land();
    show(ui.prompt, false);
    show(ui.hud, false);
    standingPose = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    document.exitPointerLock();

    const { pos, look } = station.seatPose();
    tweenCamera(pos, lookQuat(pos, look), 0.7, () => {
        show($('seat-touch'), touch);              // phones: ✕ / ⌨ buttons
        try {
            terminal.open(station);
        } catch (err) {
            // never leave the player stuck in the chair
            console.error('Computer failed to start', err);
            toast('The computer crashed: ' + err.message);
            standUp();
        }
    });
}

function standUp() {
    if (state !== 'seated' || tween) return;        // not seated, or still sitting down / standing up
    show($('seat-touch'), false);
    terminal.close();
    tweenCamera(standingPose.pos, standingPose.quat, 0.5, () => {
        show(ui.hud);
        backToPlaying();
    });
}

// ---------------------------------------------------------------- inspecting an image cube
let inspected = null;
let inspectedRoom = null;
let dragging = null;

function inspect(room, cube) {
    state = 'inspect';
    player.enabled = false;
    player.land();
    inspected = cube;
    inspectedRoom = room;
    room.cubes.forEach((c) => { c.visible = c === cube; });    // others floating nearby would block the view
    cube.userData.held = true;            // stop its idle spin
    show(ui.prompt, false);
    standingPose = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    document.exitPointerLock();
    const { pos, look } = room.inspectPose(cube);
    tweenCamera(pos, lookQuat(pos, look), 0.6, () => {
        show(ui.inspectbar);
        renderer.domElement.style.cursor = 'grab';
    });
}

function endInspect() {
    if (state !== 'inspect' || tween) return;
    show(ui.inspectbar, false);
    renderer.domElement.style.cursor = '';
    dragging = null;
    tweenCamera(standingPose.pos, standingPose.quat, 0.5, () => {
        inspected.userData.held = false;
        inspectedRoom.cubes.forEach((c) => { c.visible = true; });
        inspected = null;
        backToPlaying();
    });
}
ui.inspectBack.addEventListener('click', () => endInspect());

// click and hold to turn the cube
const canvasEl = renderer.domElement;
canvasEl.addEventListener('pointerdown', (e) => {
    if (state !== 'inspect' || tween) return;
    dragging = { x: e.clientX, y: e.clientY };
    canvasEl.setPointerCapture(e.pointerId);
    canvasEl.style.cursor = 'grabbing';
});
canvasEl.addEventListener('pointermove', (e) => {
    if (!dragging || !inspected) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging = { x: e.clientX, y: e.clientY };
    // turn around the camera's up and right axes so dragging feels like grabbing the cube
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const parentInv = inspected.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    inspected.rotateOnWorldAxis(up.applyQuaternion(parentInv), dx * 0.01);
    inspected.rotateOnWorldAxis(right.applyQuaternion(parentInv), dy * 0.01);
});
const stopDrag = () => {
    dragging = null;
    if (state === 'inspect') canvasEl.style.cursor = 'grab';
};
canvasEl.addEventListener('pointerup', stopDrag);
canvasEl.addEventListener('pointercancel', stopDrag);

// ---------------------------------------------------------------- live updates / re-sorting rooms
// Rooms are sorted newest-activity-first. When a thread or reply comes in, rooms
// get re-sorted - but not while you're sitting at a computer or looking at a cube
// (the camera animation would put you back in the wrong place), so it waits.
let layoutPending = false;
function requestLayout() { layoutPending = true; }

function applyLayout() {
    layoutPending = false;
    // if we're inside a room, move with it so we don't end up inside a wall
    const room = hotel.roomAt(camera.position);
    let local, relQuat;
    if (room) {
        local = room.group.worldToLocal(camera.position.clone());
        relQuat = room.group.quaternion.clone().invert().multiply(camera.quaternion);
    }
    hotel.layout();
    if (room) {
        camera.position.copy(room.group.localToWorld(local));
        camera.quaternion.copy(room.group.quaternion).multiply(relQuat);
    }
}

function startMultiplayer() {
    net = new Multiplayer({
        scene, camera, hotel,
        onThread: (thread) => { hotel.addRoom(thread, false); requestLayout(); },
        onReply: (reply) => { if (hotel.addReply(reply)) requestLayout(); },
        onShot: (origin, dir) => gun.spawn(origin, dir, false),
        onWallImage: (slot, url) => hotel.setWallImage(slot, url),
        onShuffle: (msg) => applyShuffle(msg),
        onHit: (dir) => {
            // someone shot us: fly! (not while sitting at a computer / looking at a cube)
            if (!tween && ['start', 'playing', 'free', 'overlay'].includes(state)) player.knockback(knockVelocity(dir));
        },
    });
    net.getAir = () => player.air;
    net.connect();
    show($('online'));
    setInterval(() => { $('online').textContent = `${net.online} online`; }, 1000);
}

// ---------------------------------------------------------------- loop
let lastRoom;
function updateRoomLabel() {
    const room = hotel.roomAt(camera.position);
    const key = room ? `${room.id}:${room.thread.reply_count}` : null;
    if (key === lastRoom) return;
    lastRoom = key;
    show(ui.roomLabel, !!room);
    if (room) {
        const n = room.thread.reply_count ?? 0;
        ui.roomLabel.innerHTML = '';
        ui.roomLabel.append(`Room ${room.id} · ${room.thread.thread_title}`);
        const small = document.createElement('small');
        small.textContent = `${n} ${n === 1 ? 'reply' : 'replies'}`;
        ui.roomLabel.append(small);
    }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);

    if (tween) {
        tween.t = Math.min(1, tween.t + dt / tween.duration);
        const k = tween.t * tween.t * (3 - 2 * tween.t);   // smoothstep
        camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
        camera.quaternion.slerpQuaternions(tween.fromQuat, tween.toQuat, k);
        if (tween.t === 1) { const done = tween.done; tween = null; done(); }
    }

    // Seated: a new reply makes the room longer, which moves the desk. Follow it.
    if (state === 'seated' && !tween && terminal.station) {
        const { pos, look } = terminal.station.seatPose();
        if (camera.position.distanceToSquared(pos) > 1e-4) {
            const k = 1 - Math.exp(-dt * 6);
            camera.position.lerp(pos, k);
            camera.quaternion.slerp(lookQuat(pos, look), k);
        }
    }

    if (layoutPending && !tween && ['start', 'playing', 'free'].includes(state)) applyLayout();

    // Portrait phone at a computer: widen the view so the whole screen fits.
    const wantFov = state === 'seated' && camera.aspect < 1
        ? Math.min(120, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) / camera.aspect)))
        : 70;
    if (Math.abs(camera.fov - wantFov) > 0.1) {
        camera.fov += (wantFov - camera.fov) * (1 - Math.exp(-dt * 8));
        camera.updateProjectionMatrix();
    }

    player.update(dt, hotel.colliders());
    hotel.update(dt, camera.position);
    net?.update(dt);
    gun.update(dt);
    gun.setVisible(!tween && ['playing', 'free', 'overlay'].includes(state));
    touchControls?.setVisible(state === 'playing');

    if (state === 'playing') {
        target = findTarget();
        show(ui.prompt, !!target && !touch);         // touch: the USE button shows it instead
        // minimal on purpose: just the key, no description
        if (target) ui.prompt.textContent = 'E';
        touchControls?.setUse(target ? 'USE' : null);
        updateRoomLabel();
    }

    renderer.render(scene, camera);
});

// ---------------------------------------------------------------- boot
// The small note under the Enter button (entrance.html can leave out id="data-mode").
function setDataMode(text) { const el = $('data-mode'); if (el) el.textContent = text; }

try {
    await Promise.all([hotel.load(), loadMyName()]);
    ui.enter.disabled = false;
    ui.enter.textContent = ui.enter.dataset.ready || 'Enter';     // text set by data-ready="..." in entrance.html
    if (await api.mode() === 'mock') setDataMode('Demo data (no server connected)');
    else startMultiplayer();
} catch (err) {
    console.error(err);
    ui.enter.textContent = 'Could not load the hotel';
    setDataMode('Error: ' + err.message);
}

// Dev helpers: poke at things from the browser console, e.g. hotelDebug.camera.position
window.hotelDebug = { THREE, renderer, scene, camera, hotel, player, api, terminal, gun, sitDown, inspect, endInspect, get net() { return net; } };
