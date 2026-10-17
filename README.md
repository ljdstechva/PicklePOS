# PicklePOS

Offline point-of-sale for a pickleball club with a small cafe. Runs on an old Windows laptop in Chrome or Edge and prints receipts on a 58 mm thermal printer (tested with the POS-5890U-L).

- **Sell:** cafe orders with dish photos, open tabs, split payments (Cash, GCash, Maya, Bank Transfer), and the Senior/PWD 20% discount.
- **Courts:** hourly court timers and bookings, with billing rules.
- **Kitchen screen:** shows the orders to prepare, so the printer is used only for customer receipts.
- **Stock:** one tap marks an item **Out of stock** (no counting).
- **Staff:** the owner and employees each have a PIN. The owner chooses what each employee can use. *Standard* employees can take orders and manage stock.
- **Reports:** Z-reading, Excel export and daily backups.
- **Automatic updates** from this GitHub repository, installed on the next restart.
- Works without internet. Sales data stays on the laptop and is never uploaded.

## Install on a new laptop

1. Install **Google Chrome**. Microsoft Edge also works.
2. Download PicklePOS: **[PicklePOS-main.zip](https://github.com/ljdstechva/PicklePOS/archive/refs/heads/main.zip)**, or use **Code → Download ZIP** on this page.
3. Right-click the downloaded zip, choose **Properties**, tick **Unblock** if you see it, and press **OK**. This stops Windows from asking for permission every time the app opens.
4. Extract the zip and move the folder to a permanent place, for example `C:\PicklePOS`. Don't use a USB stick.
5. Right-click **Start POS.bat**, choose **Send to → Desktop (create shortcut)**, and rename the shortcut to *PicklePOS*.
6. Open the shortcut. On first use, PicklePOS asks for:
   - the business name and logo (the logo becomes the app icon);
   - the owner's name and PIN;
   - employees, each with a name, a PIN and what they can use.

If Windows shows **"Windows protected your PC"**, press **More info → Run anyway**. This appears only the first time.

After that, PicklePOS updates itself whenever the laptop has internet (see [How updates work](#how-updates-work)). You don't need to download it again.

**Moving to a new laptop:** install PicklePOS as above, then copy the old laptop's `data` folder into the new PicklePOS folder before opening it. Or restore a backup from Settings → Backup & Restore.

The full guide is in [SETUP GUIDE.txt](SETUP%20GUIDE.txt). It covers installing the printer driver, setting paper size, daily use and backups.

## How updates work

`Start POS.bat` starts `launcher\PicklePOS.ps1` hidden in the background. The launcher works on Windows 7 and newer. It does the following:

1. Installs an update that was downloaded earlier. This happens only while the app is closed. The `data` folder, which holds all sales, is never touched. The previous version is kept in `updates\previous`.
2. Opens PicklePOS in its own window.
3. When there is internet, compares the `version.js` file here with the one on the laptop: 20 seconds after opening, then every 3 hours. If this one is newer, it downloads it to `updates\ready`.
4. The app then shows **"PicklePOS x.y.z is ready – Restart Now"**. Restarting closes and reopens the window, which installs the update. If nobody presses it, the update installs the next time the app is opened.

Owners can also press **Settings → About & Updates → Check for Updates Now**. The log is in `updates\update-log.txt`.

### Publishing an update

1. Make the changes.
2. Raise the version in `version.js`, for example `1.1.0` → `1.1.1`, and update `POS_NOTES`.
3. Commit and push to `main`.

Every laptop picks up the update the next time it checks.

## Folder layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app (plain HTML/JS, no build step, no internet needed) |
| `version.js` | Version number checked by the updater |
| `Start POS.bat` | Opens the POS with silent receipt printing |
| `Test POS.bat` | Practice mode with separate data (`test-data`) and a print dialog |
| `launcher/PicklePOS.ps1` | Opens the app, installs updates, checks GitHub |
| `data/` | **Your sales data.** It is created on first run and never uploaded or updated. Back it up using Reports → Close Day & Backup. |

The font is Plus Jakarta Sans, licensed under the SIL Open Font License 1.1.
