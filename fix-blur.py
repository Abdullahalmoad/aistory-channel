path = 'services/render.service.js'
with open(path) as f:
    content = f.read()

old_block = "`[bg]scale=480:854,boxblur=8:1,scale=1080:1920[bgblur];` +\n      `[fg]scale=1080:-1[fgscaled];` +"
new_block = "`[bg]scale=320:568,boxblur=6:1,scale=720:1280[bgblur];` +\n      `[fg]scale=720:-1[fgscaled];` +"

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(path, 'w') as f:
        f.write(content)
    print('FIXED successfully')
else:
    print('Pattern not found - checking current state...')
    import re
    for i, line in enumerate(content.split('\n'), 1):
        if 'bgblur' in line or 'fgscaled' in line:
            print(f'{i}: {line}')
