import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
// Pins the extension ID so the native messaging host can allow it (see native-host/).
import extension from './extension.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'AI Tab Grouper',
    description: 'Group your tabs by feature, not by website, using Claude and your own instructions.',
    key: extension.key,
    permissions: ['tabs', 'tabGroups', 'scripting', 'storage', 'sidePanel', 'nativeMessaging'],
    // Needed to read page text from open tabs and to call the Anthropic API.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Group tabs with AI' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+G' },
        description: 'Open the tab grouper',
      },
    },
  },
});
