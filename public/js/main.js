// main.js - sets up three.js, the start screen, and the game states:
//   start -> playing <-> paused
//                    <-> overlay (reading a reply in full)
//                    <-> seated  (typing at a computer: reply in a room, new thread in the lobby)
//                    <-> inspect (looking at an image cube, drag to turn it)

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { api } from './api.js';
import { createMaterials } from './materials.js';
import { Hotel } from './hotel.js';
import { Player } from './player.js';
import { Terminal } from './terminal.js';
import { Multiplayer } from './net.js';

const $ = (id) => document.getElementById(id);
const ui = {
    start: $('start'), enter: $('enter-btn'), pause: $('pause'), resume: $('resume-btn'),
    hud: $('hud'), prompt: $('prompt'), roomLabel: $('room-label'), toast: $('toast'),
    reader: $('reader'), readerPoster: $('reader-poster'), readerDate: $('reader-date'),
    readerBody: $('reader-body'), readerClose: $('reader-close'),
    seatbar: $('seatbar'), seatHint: $('seat-hint'), attach: $('attach-btn'), inspectbar: $('inspectbar'),
};
document.title = CONFIG.HOTEL_NAME;

// ---------------------------------------------------------------- three.js
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
$('viewport').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
scene.fog = new THREE.Fog(0x111111, 12, 45);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, CONFIG.EYE_HEIGHT, 4.5);   // lobby, facing down the corridor

addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

const hotel = new Hotel(scene, createMaterials(), api);
const player = new Player(camera, renderer.domElement);
const terminal = new Terminal({
    input: $('term-input'),
    fileInput: $('file-input'),
    hint: ui.seatHint,
    api,
    onExit: standUp,
    onThreadCreated: (thread) => { hotel.addRoom(thread, false); requestLayout(); },
});

// ---------------------------------------------------------------- state
let state = 'start';
const show = (el, on = true) => el.classList.toggle('hidden', !on);

function lockPointer() {
    try {
        const p = renderer.domElement.requestPointerLock();
        p?.catch?.(() => show(ui.pause));          // e.g. re-locking too soon after Esc
    } catch { show(ui.pause); }
}

player.controls.addEventListener('lock', () => {
    state = 'playing';
    player.enabled = true;
    [ui.pause, ui.reader, ui.start].forEach((el) => show(el, false));
    show(ui.hud);
});
player.controls.addEventListener('unlock', () => {
    player.enabled = false;
    if (state === 'playing') {        // Esc pressed while walking
        state = 'paused';
        show(ui.pause);
    }
});

ui.enter.addEventListener('click', () => { show(ui.start, false); show(ui.hud); lockPointer(); });
ui.resume.addEventListener('click', lockPointer);
ui.pause.addEventListener('click', (e) => { if (e.target === ui.pause) lockPointer(); });

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

function promptFor(t) {
    if (t.type === 'computer') return t.station.kind === 'thread' ? '[E] Sit down: start a new thread' : '[E] Sit down and reply';
    if (t.type === 'image') return '[E] Look at image';
    return '[E] Read reply';
}

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
}
// One keydown handler, so the same E press can't both start and end something.
addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat) {
        if (state === 'playing') interact();
        else if (state === 'inspect') endInspect(true);
    } else if (e.key === 'Escape') {
        if (state === 'overlay') closeOverlay();
        else if (state === 'inspect') endInspect(false);
        else if (state === 'seated') standUp();     // works even if the typing box lost focus
    } else if (state === 'seated' && !tween && document.activeElement !== terminal.input) {
        terminal.focus();                           // focus moved away (e.g. clicked a button): grab it back
    }
});
renderer.domElement.addEventListener('mousedown', () => {
    if (state === 'playing') interact();
    else if (state === 'seated') terminal.focus();
});

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

// Esc on an overlay: close it (the pause screen asks for a click to re-lock the mouse)
function closeOverlay() {
    show(ui.reader, false);
    state = 'paused';
    show(ui.pause);
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
    show(ui.prompt, false);
    show(ui.hud, false);
    standingPose = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    document.exitPointerLock();

    const { pos, look } = station.seatPose();
    tweenCamera(pos, lookQuat(pos, look), 0.7, () => {
        show(ui.seatbar);
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
    terminal.close();
    show(ui.seatbar, false);
    tweenCamera(standingPose.pos, standingPose.quat, 0.5, () => {
        state = 'paused';
        show(ui.hud);
        show(ui.pause);
    });
}
ui.attach.addEventListener('click', () => terminal.attach());

// ---------------------------------------------------------------- inspecting an image cube
let inspected = null;
let dragging = null;

function inspect(room, cube) {
    state = 'inspect';
    player.enabled = false;
    inspected = cube;
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

function endInspect(viaKeyE) {
    if (state !== 'inspect' || tween) return;
    show(ui.inspectbar, false);
    renderer.domElement.style.cursor = '';
    dragging = null;
    tweenCamera(standingPose.pos, standingPose.quat, 0.5, () => {
        inspected.userData.held = false;
        inspected = null;
        state = 'paused';
        // A key press (E) lets us grab the mouse again straight away; Esc doesn't.
        if (viaKeyE) lockPointer();
        else show(ui.pause);
    });
}

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

let net = null;     // multiplayer, only when connected to the real server
function startMultiplayer() {
    net = new Multiplayer({
        scene, camera, hotel,
        onThread: (thread) => { hotel.addRoom(thread, false); requestLayout(); },
        onReply: (reply) => { if (hotel.addReply(reply)) requestLayout(); },
    });
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

    if (layoutPending && !tween && ['start', 'playing', 'paused'].includes(state)) applyLayout();

    player.update(dt, hotel.colliders());
    hotel.update(dt, camera.position);
    net?.update(dt);

    if (state === 'playing') {
        target = findTarget();
        show(ui.prompt, !!target);
        if (target) ui.prompt.textContent = promptFor(target);
        updateRoomLabel();
    }

    renderer.render(scene, camera);
});

// ---------------------------------------------------------------- boot
try {
    await hotel.load();
    ui.enter.disabled = false;
    ui.enter.textContent = 'Enter';
    if (await api.mode() === 'mock') $('data-mode').textContent = 'Demo data (no server connected)';
    else startMultiplayer();
} catch (err) {
    console.error(err);
    ui.enter.textContent = 'Could not load the hotel';
    $('data-mode').textContent = 'Error: ' + err.message;
}

// Dev helpers: poke at things from the browser console, e.g. hotelDebug.camera.position
window.hotelDebug = { THREE, renderer, scene, camera, hotel, player, api, terminal, sitDown, inspect, endInspect, get net() { return net; } };
