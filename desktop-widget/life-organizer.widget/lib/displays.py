"""Return active displays without requesting screen-recording access."""
import ctypes
import json

def displays():
    cg = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    ids = (ctypes.c_uint32 * 32)()
    count = ctypes.c_uint32()
    if cg.CGGetActiveDisplayList(32, ids, ctypes.byref(count)) != 0 or not count.value:
        return None
    return [{'id': int(ids[i]), 'builtin': bool(cg.CGDisplayIsBuiltin(ids[i]))}
            for i in range(count.value)]

if __name__ == '__main__':
    print(json.dumps(displays()))
