# Backend setup (Google Sheet + Apps Script)

This gives the static site (hosted on GitHub Pages) a free read/write JSON API. Takes about 10 minutes.

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it e.g. **"World Cup Pool"**.
2. Rename the first tab to **`Tickets`**. Row 1 headers (exact spelling, case-sensitive):
   ```
   TicketId | Name | Team | Amount | Timestamp
   ```
   Leave it empty otherwise — the app fills it in.
3. Add a second tab named **`Teams`**. Row 1 headers:
   ```
   Team | Eliminated | Round | Date
   ```
   Below that, add one row per World Cup team, with `Eliminated` set to `FALSE` for all of them, e.g.:
   ```
   Argentina   FALSE
   Brazil      FALSE
   France      FALSE
   ...
   ```
   Fill in the actual 48 qualified teams for the 2026 tournament (check the official bracket — qualification wasn't fully final as of this app's build date). You can edit this list any time directly in the sheet; the website's team dropdown reads from it live.
4. Add a third tab named **`Config`**. Row 1 headers:
   ```
   Key | Value
   ```
   Add these rows:
   ```
   SharedPassword | <pick a password your team will use to place bets>
   AdminPassword  | <pick a different, stronger password — only you should know this>
   ```

## 2. Add the Apps Script backend

1. In the Sheet, go to **Extensions > Apps Script**.
2. Delete the placeholder code in `Code.gs` and paste in the contents of [`Code.gs`](./Code.gs) from this repo.
3. Click **Save** (disk icon). Name the project e.g. "World Cup Pool API".

## 3. Deploy as a Web App

1. Click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Settings:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**. Authorize the script when prompted (it needs access to your own Sheet).
5. Copy the **Web app URL** — it looks like `https://script.google.com/macros/s/XXXXXXXX/exec`.

## 4. Wire it into the frontend

Open [`../app.js`](../app.js) in this project and replace:

```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with your deployment URL. Save, then reload `index.html`.

## 5. Test it

- Open the site — you'll see a password gate. Enter the `SharedPassword` you set in the Config tab. Viewing pool stats, teams, and the leaderboard all require this password now (not just placing bets).
- Place a test bet from the site (1-3 teams, splits totaling exactly Rs.500, multiples of 10, min Rs.100 each).
- Check the `Tickets` tab — you should see one row per pick, sharing a `TicketId`.
- To simulate an elimination, flip a team's `Eliminated` cell to `TRUE` directly in the `Teams` tab (or send a POST with `action: "eliminateTeam"` and the `AdminPassword`) — the site picks it up within 60 seconds.
- To declare a champion and trigger payouts, send a POST with `action: "declareChampion"`, the `team` name, and the `AdminPassword`. A `Winners` tab will be created automatically with proportional payouts.

## Admin: resetting the pool

Logging in with the `AdminPassword` unlocks a hidden **Admin** tab on the site with a "Reset Pool" control (type `RESET` to confirm). This wipes all bets, sets every team back to alive, and clears the champion/winners — use it to start a new pool from scratch. There's no undo, so double-check before confirming.

## Redeploying after editing Code.gs

If you change `Code.gs` later, use **Deploy > Manage deployments > Edit (pencil) > New version > Deploy** — the web app URL stays the same.
