path = 'services/render.service.js'
with open(path) as f:
    content = f.read()

old_line = "`[bg]scale=480:854,boxblur=8:1,scale=1080:1920[bgblur];` +"
new_line = "`[bg]scale=320:568,boxblur=6:1,scale=720:1280[bgblur];` +"

if old_line in content:
    content = content.replace(old_line, new_line)
    with open(path, 'w') as f:
        f.write(content)
    print('FIXED successfully')
else:
    print('still not found')
