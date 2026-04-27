# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['installer.py'],
    pathex=[],
    binaries=[('dist\\sentinel_agent.exe', '.'), ('dist\\sentinel_tray.exe', '.'), ('dist\\sentinel_watchdog.exe', '.')],
    datas=[],
    hiddenimports=['requests', 'urllib3', 'tkinter', 'tkinter.ttk', 'tkinter.messagebox', 'tkinter.font', 'json', 'os', 'platform', 'shutil', 'socket', 'subprocess', 'sys', 'threading', 'uuid', 'hashlib', 'ctypes', 'ctypes.wintypes', 'winreg', 'pathlib'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='setup',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    uac_admin=True,
)
