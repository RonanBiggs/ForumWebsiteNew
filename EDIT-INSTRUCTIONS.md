# Editing it yourself

All paths are relative to the `Hotel3D/` folder. Everything the browser sees is in `public/`.
Test your edits locally with `npm start` (see README), then reload the page.
To put a change online, commit and push it: Render redeploys automatically.

---

## The entrance screen (the page with the "Enter" button)

It's its own file: **`public/entrance.html`**. Edit it like any web page. You can even open it straight in your browser to preview it (double-click it); then reload the game to see it in place.

**How it works:** when the game starts, `js/main.js` loads `entrance.html` and copies everything inside its `<body>`, plus its `<style>` block, onto the start screen.

**What you can change:**
- **Text:** the title (`<h1>The Dom Forum</h1>`), the tagline, the controls lists. Add whatever you like inside `<div class="entrance">`, such as more paragraphs, links or a rules list.
- **Look:** the `<style>` block at the top. `.entrance` is the full-screen background (colour, gradient, font), `.entrance h1` is the title, `.entrance #enter-btn` is the button.
- **Images:** put the file in `public/` (e.g. `public/logo.png`) and add `<img src="logo.png" alt="">` inside the entrance div. Style it with `.entrance img { ... }`.
- **Phone vs computer text:** anything with `class="desktop-only"` only shows on computers, `class="touch-only"` only on phones/tablets.
- **Button text:** the button says "Loading…" until the hotel has loaded, then whatever `data-ready="..."` says (now `Enter`).

**Rules (or it breaks):**
- Keep `<button id="enter-btn" ...>`. The game looks for that id. Without it, the plain fallback start screen from `index.html` is used instead.
- Start every CSS rule with `.entrance` so it can't restyle the rest of the game.
- `<script>` tags are ignored. Code that runs belongs in `public/js/`.
- `<p id="data-mode">` shows "Demo data" or load errors. You can delete it if you don't want that.

| Other start-screen bits | Where |
|---|---|
| **What the button does** | `public/js/main.js`, the line `ui.enter.addEventListener('click', ...)`. It hides the start screen and starts the game |
| **Fallback start screen** (only used if `entrance.html` can't load) | `public/index.html`, inside `<div id="start">` |
| **Browser tab title** | `<title>` in `public/index.html`, and `HOTEL_NAME` in `public/js/config.js` (it overwrites the title) |

---

## The sign above the lobby computer

| What | Where |
|---|---|
| **The text** | `public/js/config.js`: `LOBBY_SIGN_TEXT: 'The Dom Forum'` |
| **Size, position, height** | `public/js/hotel.js`, inside `buildCorridor()`, below the comment `// LOBBY SIGN` (around line 130) |
| **Look** (white background, black border, font) | `labelTexture()` in `public/js/textures.js`. The door title signs use the same function |

The `addSign(...)` line in `hotel.js` takes these values:
- `w`, `h`: width and height in metres. Keep about the same ratio as the texture (1024 × 192) or the text stretches.
- `y`: height of the sign's centre above the floor. The ceiling is at 3.2.
- `z`: position along the wall. The computer is at `z: 3`.
- `x: halfW - 0.01`: sits it just off the lobby's right wall. Don't change this unless you move the sign to another wall.

To add **more signs**, copy that `addSign(...)` line and change the text and position.
Long text shrinks to fit, and then gets cut off with "…".

---

## The gun

Click (or **F**, hold it to spray) on a computer, **FIRE** on a phone. No ammo, no cooldown. A ball that hits another player launches them.

| What | Where |
|---|---|
| Ball speed, size, how long balls last, how hard a hit launches people (`PUSH` sideways, `LIFT` upwards), colour | `GUN` at the top of `public/js/gun.js` |
| The gun model in your hand (placeholder boxes) | the `// PLACEHOLDER gun model` part of the `Gun` constructor in `public/js/gun.js` |
| Gravity / bouncing while flying after a hit | `GRAVITY` at the top of `public/js/player.js`, and `updateKnock()` |
| Server spam limit for messages (positions + shots) | `MAX_MSGS_PER_SEC` at the top of `server/multiplayer.js` |

---

## Phone / tablet controls

Turned on automatically on touch screens. Add `?touch=1` to the address to try them on a computer (narrow the browser window or use the browser's device mode), or `?touch=0` to force them off.

| What | Where |
|---|---|
| Joystick, FIRE / USE / pause buttons: look and position | `public/style.css`, the `Touch controls` section at the bottom |
| Look sensitivity, joystick size | `LOOK_SPEED`, `STICK_RADIUS` at the top of `public/js/touch.js` |
| Buttons while sitting at a computer (Post, Next field, Keyboard, Stand up) | `<div id="seatbar">` in `public/index.html` |

---

## Other things you'll probably want to change

| What | Where |
|---|---|
| Thread title signs above the doors | `buildShell()` in `public/js/room.js`, the `addSign(... labelTexture(this.thread.thread_title) ...)` line |
| Wall / floor / ceiling / furniture colours (placeholder grid textures) | `createMaterials()` in `public/js/materials.js` |
| How a reply looks on the wall | `replyPanelTexture()` in `public/js/textures.js` |
| Spacing of replies along the wall, and how fast rooms get longer | constants at the top of `public/js/room.js` (`SPACING`, `FIRST_Z`, `PANEL_Y`, …) and `roomDepth()` |
| Image cube size / how far it floats from the wall | `CUBE_SIZE`, `CUBE_OUT` at the top of `public/js/room.js` |
| How the image wraps around the cube | `wrappedCubeGeometry()` at the bottom of `public/js/room.js` |
| The computer (desk, chair, screen) in rooms and lobby | `buildComputerDesk()` in `public/js/computer.js`. To use your own `.glb` model, see the README |
| What the computer screens show | `public/js/terminal.js` (`drawReply`, `drawThreadForm`) and the idle screens: `drawScreenIdle()` in `public/js/room.js`, and `lobbyStation` in `public/js/hotel.js` |
| Lobby size / layout | `LOBBY` at the top of `public/js/hotel.js`, and `buildCorridor()` |
| Menus, HUD, prompt text style | `public/style.css` and `public/index.html` |
| Walk / run speed, eye height | `public/js/config.js` |
| Other players (the pill): size, colour, how often positions are sent | top of `public/js/net.js` (`PILL_RADIUS`, `PILL_HEIGHT`, `SEND_EVERY`) and `pillMaterial` in its constructor |
| Max image size, spam limit | top of `server/index.js` (`MAX_IMAGE_BYTES`, `WRITES_PER_MINUTE`) |
