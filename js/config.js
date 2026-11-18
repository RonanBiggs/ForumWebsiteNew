// config.js - everything you're likely to tweak lives here.

export const CONFIG = {
    HOTEL_NAME: 'The Hotel',

    // Sign on the wall above the lobby computer (drawn in hotel.js -> buildCorridor()).
    LOBBY_SIGN_TEXT: 'Sample text: edit me in js/config.js',

    // 'auto'  = use the real database (api/*.php) when the PHP backend is there,
    //           otherwise fake demo threads stored in this browser
    // 'php'   = always the real database      'mock' = always the demo data
    API_MODE: 'auto',
    API_BASE: 'api/',

    // Set to e.g. 'models/computer.glb' once you've modelled one.
    // Name the screen mesh "Screen" in Blender and it will show the terminal.
    COMPUTER_MODEL_URL: null,

    WALK_SPEED: 3.2,   // m/s
    RUN_SPEED: 6.0,
    EYE_HEIGHT: 1.6,
};
