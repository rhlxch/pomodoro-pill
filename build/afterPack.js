// Sets the app icon + version info on the Windows exe without Wine (pure-JS resource editing).
const fs = require('fs');
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exeObj = PE.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exeObj);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups.length ? groups[0] : { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, iconFile.icons.map(i => i.data));
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vis.length) {
    const vi = vis[0];
    const langs = vi.getAllLanguagesForStringValues();
    const lang = langs[0] || { lang: 1033, codepage: 1200 };
    vi.setStringValues(lang, {
      ProductName: 'Pomodoro Pill', FileDescription: 'Pomodoro Pill', CompanyName: 'Rahul',
      OriginalFilename: 'Pomodoro Pill.exe', InternalName: 'Pomodoro Pill', LegalCopyright: '© 2026 Rahul'
    });
    const [a, b, c] = context.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(a, b, c, 0, lang.lang); vi.setProductVersion(a, b, c, 0, lang.lang);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
  console.log('  • afterPack: icon + version info applied to', path.basename(exe));
};
