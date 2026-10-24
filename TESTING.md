# TabDoze Release Checklist

## Automated

```bash
npm test
npm run check
npm run package
unzip -tq dist/tabdoze-*-extension.zip
```

## Install And Identity

- [ ] Load the unpacked release without manifest errors.
- [ ] Toolbar, popup, settings, onboarding, and statistics pages show TabDoze branding.
- [ ] The toolbar icon is readable at normal browser size.
- [ ] Updating the same unpacked directory keeps extension ID `dhipcaijoipciglemoefjdlidjmjpnki` and existing settings.

## Sleep And Wake

- [ ] **Sleep Other Tabs** discards eligible background tabs.
- [ ] The active tab, keep-awake domains, and browser pages remain awake.
- [ ] An eligible tab sleeps after its inactivity deadline; loading in the background does not restart the deadline.
- [ ] Service-worker restart preserves current-session inactivity timestamps.
- [ ] A sleeping page keeps its original favicon and receives a best-effort `💤` title prefix.
- [ ] A page that frequently rewrites its title still shows the `💤` prefix after discard.
- [ ] Selecting a discarded tab wakes it in place.
- [ ] A woken tab starts a fresh inactivity timer after switching away and can sleep a second time.
- [ ] Individual **Sleep**, individual **Wake**, and **Wake All** work.

## Settings And Statistics

- [ ] The 1-120 minute schedule saves and takes effect immediately.
- [ ] Keep-awake domains can be added, removed, exported, and imported.
- [ ] Statistics are labeled as estimates and export to `tabdoze-stats.json`.
- [ ] Reset clears statistics only after confirmation.

## Performance

- [ ] Opening the popup does not cause sustained service-worker CPU activity.
- [ ] Closing popup and statistics pages leaves no extension interval running.
- [ ] A 50+ tab window remains responsive while rendering the popup list.

Record the Chromium version, operating system, extension version, and any known issue in the release notes.
