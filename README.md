<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1M4_C_vp-J3GiexzVQ-LOoq1p8Jcc0eAP

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Generate Static View Snapshots

Need to hand off fully styled HTML? Run:

```bash
npm run export:static
```

This compiles each view under `views/` into a standalone page inside the `static/` folder using the shared layout in `templates/base-layout.html`. The exported files keep the production CSS and asset paths so they can be opened locally or delivered for Delphi integration without extra wiring.
