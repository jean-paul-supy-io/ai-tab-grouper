import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // Clicking the toolbar icon (or Alt+Shift+G) opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
