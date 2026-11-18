# Editing it yourself

All paths are relative to the `Hotel3D/` folder. While testing locally, run it with
`php -S localhost:8001 dev-server.php`, so a normal browser reload always picks up your edits.
With plain `php -S`, the browser can keep using old copies of the files.

---

## The opening page (the "Enter" button)

| What | Where |
|---|---|
| **Content**: the Enter button, the controls hint, the demo-data note | `index.html`, the block starting at `<!-- Start screen -->` (the `<div id="start">`, around line 23) |
| **Look**: the background, the white box, the button size | `style.css`: `#start` (background), `.panel` (the white box), `#enter-btn` (the button) |
| **What the button does** | `js/main.js`, the line `ui.enter.addEventListener('click', ...)` (around line 83). It hides the start screen and captures the mouse |
| **"Loading…" / "Enter" text** and the "Demo data" note | `js/main.js`, the `// ---- boot` section at the bottom. The button stays disabled ("Loading…") until the hotel has loaded |
| **Browser tab title** | `<title>` in `index.html`, and `HOTEL_NAME` in `js/config.js` (it overwrites the title) |

You can add anything inside `<div id="start">`, such as a heading, an image or text. Keep the `<button id="enter-btn">`, because the code looks for that id.

---

## The sign above the lobby computer

| What | Where |
|---|---|
| **The text** | `js/config.js`: `LOBBY_SIGN_TEXT: 'Sample text: edit me in js/config.js'` |
| **Size, position, height** | `js/hotel.js`, inside `buildCorridor()`, below the comment `// LOBBY SIGN` (around line 127) |
| **Look** (white background, black border, font) | `labelTexture()` in `js/textures.js`. The door title signs use the same function |

The `addSign(...)` line in `hotel.js` takes these values:
- `w`, `h`: width and height in metres. Keep about the same ratio as the texture (1024 × 192) or the text stretches.
- `y`: height of the sign's centre above the floor. The ceiling is at 3.2.
- `z`: position along the wall. The computer is at `z: 3`.
- `x: halfW - 0.01`: sits it just off the lobby's right wall. Don't change this unless you move the sign to another wall.

To add **more signs**, copy that `addSign(...)` line and change the text and position.
Long text shrinks to fit, and then gets cut off with "…".

---

## Other things you'll probably want to change

| What | Where |
|---|---|
| Thread title signs above the doors | `buildShell()` in `js/room.js`, the `addSign(... labelTexture(this.thread.thread_title) ...)` line |
| Wall / floor / ceiling / furniture colours (placeholder grid textures) | `createMaterials()` in `js/materials.js` |
| How a reply looks on the wall | `replyPanelTexture()` in `js/textures.js` |
| Spacing of replies along the wall, and how fast rooms get longer | constants at the top of `js/room.js` (`SPACING`, `FIRST_Z`, `PANEL_Y`, …) and `roomDepth()` |
| Image cube size / how far it floats from the wall | `CUBE_SIZE`, `CUBE_OUT` at the top of `js/room.js` |
| How the image wraps around the cube | `wrappedCubeGeometry()` at the bottom of `js/room.js` |
| The computer (desk, chair, screen) in rooms and lobby | `buildComputerDesk()` in `js/computer.js`. To use your own `.glb` model, see the README |
| What the computer screens show | `js/terminal.js` (`drawReply`, `drawThreadForm`) and the idle screens: `drawScreenIdle()` in `js/room.js`, and `lobbyStation` in `js/hotel.js` |
| Lobby size / layout | `LOBBY` at the top of `js/hotel.js`, and `buildCorridor()` |
| Menus, HUD, prompt text style | `style.css` and `index.html` |
| Walk / run speed, eye height | `js/config.js` |
