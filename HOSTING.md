# Hosting on InfinityFree (with the MySQL database)

The hotel uses the **same database tables as the 2D ForumWebsite** (`threads` and `replies`).
If you host both, point them at the same database and they'll show the same threads.

## 1. Create the database
1. In the InfinityFree client area, open your hosting account. Note the **username** (`if0_…`) and click **Show** next to the **password**.
2. **Control Panel → MySQL Databases** → enter a name (e.g. `forum`) → **Create Database**.
   - Already set up the 2D forum? Skip this and the next step and reuse that database.
3. Note the **MySQL Hostname** (`sqlXXX.infinityfree.com`, **not** `localhost`) and the full **database name** (`if0_XXXXXXXX_forum`).
4. Click **Admin** next to the database to open phpMyAdmin. Select the database on the left, go to **Import**, choose **`schema.sql`**, and click **Import**.
   You should now see two tables: `threads` and `replies`.

## 2. Create `api/config.php`
Copy `api/config.sample.php` to `api/config.php` and fill in the following:
```php
define('DB_HOST', 'sqlXXX.infinityfree.com');
define('DB_USER', 'if0_XXXXXXXX');
define('DB_PASS', 'your_account_password');
define('DB_NAME', 'if0_XXXXXXXX_forum');
```
Leave the `UPLOADS_` lines as they are, unless you're sharing images with the 2D forum (see section 4).

## 3. Upload the files
Use FileZilla: host `ftpupload.net`, port `21`, your `if0_…` username and account password.
You can also use the **Online File Manager** in the control panel.

Upload into **`htdocs/`**. That puts the hotel at your site's main address. For a subfolder like `htdocs/hotel/`, see section 4.
Delete InfinityFree's default `index2.html` from `htdocs` if it's there.

**Upload these:**
```
index.html
style.css
.htaccess              (makes browsers pick up new versions of your files)
js/                    (whole folder)
api/                   (whole folder, INCLUDING your api/config.php)
uploads/               (the folder with the .htaccess inside it; images are saved here)
models/                (only if you made a computer.glb)
```
**Don't upload:** `dev-server.php`, `schema.sql`, `README.md`, `HOSTING.md`, `EDIT-INSTRUCTIONS.md`, `.gitignore`.

FileZilla shows files starting with a dot (`.htaccess`) by default. In the Online File Manager, make sure they got uploaded.

## 4. Optional: host it next to the 2D forum
If the 2D forum is in `htdocs/` and the hotel goes in `htdocs/hotel/`:
- Use the **same database** values in both `config.php` files.
- To share uploaded images, so images posted in either site show up in both, use these lines in `hotel/api/config.php`:
  ```php
  define('UPLOADS_DIR', __DIR__ . '/../../uploads');
  define('UPLOADS_URL', '../uploads/');
  ```
  and don't upload the hotel's own `uploads/` folder.

## 5. Check it works
- Open your site. Under the Enter button there should be **no** "Demo data (no database connected)" note.
  - If the note **is** there, the `api/` folder is missing or PHP isn't running it.
  - If it says **"Error: Could not connect to the database"**, check the four values in `api/config.php`.
  - If it says **"Error: Server not set up yet"**, `api/config.php` wasn't uploaded.
- Sit at the lobby computer and create a thread with a title, body and image. Walk into its room, then sit at that room's computer and post a reply.
- In phpMyAdmin you should see the new rows in `threads` and `replies`.

## Notes
- **Updating later:** re-upload only the files you changed. **Never overwrite `uploads/`** on the server, or the images people posted are lost.
- **Testing the API directly:** opening `https://yoursite/api/threads.php` in a browser should show JSON (`[]` when empty).
- **Settings:** `API_MODE` in `js/config.js` is `'auto'`. It uses the database whenever the PHP backend is there, and falls back to demo data otherwise, so you don't need to change it.
- **Moderation:** there's no admin page. To delete posts, delete rows in phpMyAdmin. Deleting a thread deletes its replies too.
