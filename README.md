# Post Studio

Paste a product URL and get ready-to-publish **single-image posts, carousels and reels** for
**Instagram, Facebook and Pinterest**. You can review them, publish them right away or schedule them.
Every service it uses is free.

| Step | Tool (free) |
|---|---|
| Read the product page | Built-in scraper (JSON-LD / Open Graph) |
| Captions, hashtags, art direction | Google Gemini free tier (Groq as an optional fallback) |
| Lifestyle images | Pollinations: your **real product photo** is placed into an AI scene (free pollen key). Falls back to text-to-image. |
| Reels | ffmpeg on your PC: Ken-Burns motion, cross-fades, on-screen text, optional music |
| Publishing | Meta Graph API (FB + IG) and Pinterest API v5 |

## 1. Setup

```powershell
cd C:\Users\Admin\social-post-automation
copy .env.example .env.local     # then fill in the keys below
npm install
npm run dev                      # open http://localhost:3000
```

For always-on use, run `npm run build` and then `npm start`. The scheduler runs inside the server,
so scheduled posts only go out while the app is running.

## 2. Free keys

1. **Gemini** (required): go to https://aistudio.google.com/apikey and create a key, then set `GEMINI_API_KEY`.
2. **Pollinations** (strongly recommended for quality): go to https://enter.pollinations.ai, sign in and create a key.
   Set it as `POLLINATIONS_KEY`.
   - It lets the AI put **your actual product** into each scene (`kontext`, falling back to `klein`).
   - Without a key, images are generic text-to-image, lower resolution, and limited to 1 image every 45 seconds.
3. Optional: `GROQ_API_KEY` (https://console.groq.com/keys) as a copy fallback, and `HF_TOKEN` as an image fallback.

`GEMINI_IMAGE_ENABLED` is `false` by default. Google bills that model if billing is enabled on your key, so leave it off to stay free.

## 3. Connect Facebook + Instagram

You need an Instagram **Business/Creator** account linked to a Facebook **Page**.

1. Go to https://developers.facebook.com, choose **Create App**, then pick the **Other** and **Business** type.
2. Add the products **Facebook Login for Business** and **Instagram** (Instagram API with Facebook Login).
3. Open **Graph API Explorer**, select your app, and use "Get User Access Token" with these permissions:
   `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management`
4. Turn it into a **long-lived** token. Open the Access Token Debugger and choose "Extend Access Token".
   Then call `GET /me/accounts` with that long-lived user token.
   The `access_token` it returns for your Page is a Page token that does not expire.
5. Put the values into `.env.local`:
   ```
   META_PAGE_ID=<page id from /me/accounts>
   META_PAGE_ACCESS_TOKEN=<page access_token from /me/accounts>
   ```
   The Instagram account ID is detected automatically. The header pill turns green when it is linked.

While your app is in **Development mode** you can post to Pages and IG accounts that you manage, so no App Review is needed for your own accounts.

## 4. Connect Pinterest

1. Go to https://developers.pinterest.com/apps, create an app, and wait for trial access.
2. Generate an access token with the scopes `boards:read, pins:read, pins:write`.
3. Find your board ID with `GET https://api.pinterest.com/v5/boards` using that token.
4. Set `PINTEREST_ACCESS_TOKEN` and `PINTEREST_BOARD_ID`.
   Trial apps must use `PINTEREST_API_BASE=https://api-sandbox.pinterest.com/v5` until Standard access is approved.
   Sandbox pins are not public.

## How it works

- **Single**: one hero lifestyle image. Instagram and Facebook get 1080×1350, Pinterest gets 1000×1500. No text on the image.
- **Carousel**: 2–10 slides, each with a different angle or setting. Elegant text overlays are optional.
  The original product photo can be added as the last slide.
- **Reel**: 3–10 scenes, rendered to a 1080×1920 MP4 with motion and on-screen text.
  To add music, set `REEL_MUSIC_PATH` to a royalty-free mp3.
- Generation runs one job at a time in the background, and the dashboard shows live progress.
- Posts can be published **now**, **scheduled**, or set to auto-publish the moment generation finishes.
- If one platform fails, use **Retry failed**. Platforms that already succeeded are never posted twice.

Data lives in `data/db.json` and media in `data/media/`.

## Instagram image hosting

Instagram's API only accepts images from a public URL. By default the app uploads each image to
your Facebook Page as an **unpublished** photo and uses that URL. Nothing appears on the Page.
If you expose the app publicly instead (for example with `cloudflared tunnel`), set `PUBLIC_BASE_URL` and that URL is used.
