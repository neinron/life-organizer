#!/usr/bin/env python3
"""Build the local first-party EventKit helper with stable identity and usage descriptions."""
from pathlib import Path
import plistlib,subprocess
ROOT=Path(__file__).resolve().parents[1]
app=ROOT/'runtime/bin/Life Organizer Helper.app';contents=app/'Contents';mac=contents/'MacOS';mac.mkdir(parents=True,exist_ok=True)
info={'CFBundleIdentifier':'net.schurer.life-organizer.helper','CFBundleName':'Life Organizer Helper','CFBundleExecutable':'apple-store','CFBundlePackageType':'APPL','CFBundleVersion':'1','LSUIElement':True,'NSCalendarsFullAccessUsageDescription':'Life Organizer liest Kalenderbelegung einschließlich Exchange für konfliktfreie Planung. Der Helfer hat keinen Befehl zum Ändern von Kalenderterminen.','NSRemindersFullAccessUsageDescription':'Life Organizer verwaltet ausschließlich eigene Frist-Hinweise in der vorhandenen Liste Life Organizer. Andere Listen bleiben unverändert.'}
plist=contents/'Info.plist';plist.write_bytes(plistlib.dumps(info))
binary=mac/'apple-store'
subprocess.run(['swiftc','-module-cache-path',str(ROOT/'runtime/build/module-cache'),'-parse-as-library',str(ROOT/'scripts/apple-store.swift'),'-o',str(binary),'-framework','EventKit','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',str(plist)],check=True)
subprocess.run(['codesign','--force','--sign','-','--identifier',info['CFBundleIdentifier'],str(app)],check=True)
link=ROOT/'runtime/bin/apple-store'
if link.exists() or link.is_symlink():link.unlink()
link.symlink_to(binary.relative_to(link.parent))
print(binary)
