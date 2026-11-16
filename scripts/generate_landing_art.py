import math
from PIL import Image, ImageDraw, ImageFilter

def create_radial_gradient(size, inner_color, outer_color, center=None, radius=None):
    w, h = size
    if center is None:
        center = (w // 2, h // 2)
    if radius is None:
        radius = math.hypot(w // 2, h // 2)
    
    img = Image.new("RGBA", (w, h), outer_color)
    # create smooth overlay
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    steps = 60
    for i in range(steps, 0, -1):
        r = radius * (i / steps)
        factor = 1.0 - (i / steps)
        # interpolate color
        c = (
            int(outer_color[0] + (inner_color[0] - outer_color[0]) * factor),
            int(outer_color[1] + (inner_color[1] - outer_color[1]) * factor),
            int(outer_color[2] + (inner_color[2] - outer_color[2]) * factor),
            int(outer_color[3] + (inner_color[3] - outer_color[3]) * factor),
        )
        draw.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=c)
    
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius / 15))
    img.alpha_composite(overlay)
    return img

def generate_tile_intent(path):
    size = (1200, 1200)
    bg = Image.new("RGBA", size, (2, 2, 2, 255))
    glow = create_radial_gradient(size, (245, 158, 11, 45), (2, 2, 2, 0), center=(600, 600), radius=550)
    bg.alpha_composite(glow)
    
    draw = ImageDraw.Draw(bg)
    # Draw dark obsidian isometric condition prism / diamond
    cx, cy = 600, 600
    r = 260
    
    # Grid lines in background
    for x in range(100, 1100, 100):
        draw.line([(x, 150), (x, 1050)], fill=(255, 255, 255, 8), width=1)
    for y in range(150, 1050, 100):
        draw.line([(100, y), (1100, y)], fill=(255, 255, 255, 8), width=1)
        
    # Floating isometric logic diamond
    top = (cx, cy - r)
    right = (cx + int(r * 1.3), cy)
    bottom = (cx, cy + r)
    left = (cx - int(r * 1.3), cy)
    
    # Outer glow ring
    for dr in range(20, 0, -2):
        alpha = int(40 * (1 - dr/20))
        draw.polygon([(top[0], top[1]-dr), (right[0]+dr, right[1]), (bottom[0], bottom[1]+dr), (left[0]-dr, left[1])],
                     outline=(245, 158, 11, alpha), width=2)
                     
    # Left facet
    draw.polygon([top, left, (cx, cy)], fill=(15, 18, 25, 250), outline=(245, 158, 11, 160), width=3)
    # Right facet
    draw.polygon([top, right, (cx, cy)], fill=(28, 24, 18, 250), outline=(245, 158, 11, 220), width=3)
    # Bottom left facet
    draw.polygon([left, bottom, (cx, cy)], fill=(10, 10, 14, 250), outline=(59, 130, 246, 140), width=3)
    # Bottom right facet
    draw.polygon([right, bottom, (cx, cy)], fill=(18, 20, 28, 250), outline=(59, 130, 246, 200), width=3)
    
    # Condition threshold symbols inside
    # Glowing rule text lines
    draw.line([(cx - 140, cy - 40), (cx + 140, cy - 40)], fill=(255, 255, 255, 180), width=4)
    draw.line([(cx - 100, cy + 10), (cx + 100, cy + 10)], fill=(245, 158, 11, 230), width=5)
    draw.line([(cx - 60, cy + 60), (cx + 60, cy + 60)], fill=(59, 130, 246, 200), width=4)
    
    bg.convert("RGB").save(path, quality=95)

def generate_tile_optimize(path):
    size = (1200, 1200)
    bg = Image.new("RGBA", size, (2, 2, 2, 255))
    glow = create_radial_gradient(size, (59, 130, 246, 60), (2, 2, 2, 0), center=(600, 600), radius=550)
    bg.alpha_composite(glow)
    
    draw = ImageDraw.Draw(bg)
    cx, cy = 600, 600
    
    # Concentric orbital rings
    for r, alpha in [(120, 180), (220, 130), (320, 90), (420, 40)]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(59, 130, 246, alpha), width=3)
        draw.ellipse([cx - r*1.2, cy - r*0.45, cx + r*1.2, cy + r*0.45], outline=(124, 92, 255, alpha//2), width=2)
        
    # Energy core
    draw.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], fill=(10, 16, 32, 255), outline=(96, 165, 250, 255), width=4)
    draw.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], fill=(96, 165, 250, 230))
    
    # Orbiting nodes
    nodes = [(cx - 220, cy), (cx + 180, cy - 120), (cx + 100, cy + 200), (cx - 120, cy + 180)]
    for nx, ny in nodes:
        draw.ellipse([nx - 16, ny - 16, nx + 16, ny + 16], fill=(2, 2, 2, 255), outline=(96, 165, 250, 255), width=3)
        draw.ellipse([nx - 8, ny - 8, nx + 8, ny + 8], fill=(255, 255, 255, 240))
        draw.line([(cx, cy), (nx, ny)], fill=(59, 130, 246, 70), width=2)

    bg.convert("RGB").save(path, quality=95)

def generate_tile_repair(path):
    size = (1200, 1200)
    bg = Image.new("RGBA", size, (2, 2, 2, 255))
    glow = create_radial_gradient(size, (34, 197, 94, 50), (2, 2, 2, 0), center=(600, 600), radius=550)
    bg.alpha_composite(glow)
    
    draw = ImageDraw.Draw(bg)
    cx, cy = 600, 600
    
    # 3D Vault Box with Emerald Security Key
    w, h, depth = 380, 420, 80
    x0, y0 = cx - w//2, cy - h//2
    
    # Back depth
    draw.rectangle([x0 + depth, y0 - depth, x0 + w + depth, y0 + h - depth], fill=(8, 18, 12, 255), outline=(34, 197, 94, 80), width=2)
    # Connect corners
    draw.line([(x0, y0), (x0 + depth, y0 - depth)], fill=(34, 197, 94, 120), width=2)
    draw.line([(x0 + w, y0), (x0 + w + depth, y0 - depth)], fill=(34, 197, 94, 120), width=2)
    draw.line([(x0 + w, y0 + h), (x0 + w + depth, y0 + h - depth)], fill=(34, 197, 94, 120), width=2)
    draw.line([(x0, y0 + h), (x0 + depth, y0 + h - depth)], fill=(34, 197, 94, 60), width=2)
    
    # Front safe face
    draw.rectangle([x0, y0, x0 + w, y0 + h], fill=(10, 12, 16, 255), outline=(34, 197, 94, 200), width=3)
    
    # Vault Dial / Shield
    draw.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], fill=(14, 20, 24, 255), outline=(34, 197, 94, 240), width=4)
    draw.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], outline=(34, 197, 94, 120), width=2)
    
    # Keyhole / Shield notch
    draw.polygon([(cx, cy - 40), (cx + 25, cy), (cx + 15, cy + 35), (cx - 15, cy + 35), (cx - 25, cy)], fill=(34, 197, 94, 220))
    
    # Bolt locks
    for by in [y0 + 80, y0 + h//2, y0 + h - 80]:
        draw.rectangle([x0 - 18, by - 12, x0, by + 12], fill=(34, 197, 94, 200))
        draw.rectangle([x0 + w, by - 12, x0 + w + 18, by + 12], fill=(34, 197, 94, 200))

    bg.convert("RGB").save(path, quality=95)

def generate_shared_brief(path):
    size = (1200, 1200)
    bg = Image.new("RGBA", size, (2, 2, 2, 255))
    glow = create_radial_gradient(size, (124, 92, 255, 60), (2, 2, 2, 0), center=(600, 600), radius=550)
    bg.alpha_composite(glow)
    
    draw = ImageDraw.Draw(bg)
    cx, cy = 600, 600
    
    # Three interlocking chain links / verification nodes
    # 1. Origin Chain (Sepolia)
    # 2. Reactive Network (Lasna ReactVM)
    # 3. Funds Destination Chain (Unichain)
    nodes = [
        (cx - 160, cy - 100, "ORIGIN EVENT", (59, 130, 246)),
        (cx + 160, cy - 100, "REACTIVE VM", (124, 92, 255)),
        (cx, cy + 160, "FUNDS EXECUTION", (20, 184, 166))
    ]
    
    # Connecting glowing bus
    draw.line([(nodes[0][0], nodes[0][1]), (nodes[1][0], nodes[1][1])], fill=(124, 92, 255, 160), width=4)
    draw.line([(nodes[1][0], nodes[1][1]), (nodes[2][0], nodes[2][1])], fill=(20, 184, 166, 160), width=4)
    draw.line([(nodes[2][0], nodes[2][1]), (nodes[0][0], nodes[0][1])], fill=(59, 130, 246, 160), width=4)
    
    for nx, ny, label, color in nodes:
        # Glow ring
        draw.ellipse([nx - 110, ny - 110, nx + 110, ny + 110], outline=(*color, 90), width=2)
        draw.ellipse([nx - 90, ny - 90, nx + 90, ny + 90], fill=(8, 10, 16, 255), outline=(*color, 240), width=4)
        draw.ellipse([nx - 55, ny - 55, nx + 55, ny + 55], fill=(*color, 60), outline=(255, 255, 255, 180), width=2)
        draw.ellipse([nx - 20, ny - 20, nx + 20, ny + 20], fill=(255, 255, 255, 240))
        
    bg.convert("RGB").save(path, quality=95)

def generate_closing_hall(path):
    size = (2400, 1080)
    w, h = size
    bg = Image.new("RGBA", size, (2, 2, 2, 255))
    
    glow1 = create_radial_gradient(size, (59, 130, 246, 40), (2, 2, 2, 0), center=(w//2, h//2), radius=900)
    glow2 = create_radial_gradient(size, (124, 92, 255, 30), (2, 2, 2, 0), center=(w//3, h//2), radius=700)
    bg.alpha_composite(glow1)
    bg.alpha_composite(glow2)
    
    draw = ImageDraw.Draw(bg)
    
    # Vanishing perspective lines (autonomous server corridor)
    vp = (w // 2, h // 2 - 40)
    
    # Ceiling & Floor tracks
    for x in range(0, w + 1, 160):
        draw.line([(x, 0), vp], fill=(59, 130, 246, 18), width=1)
        draw.line([(x, h), vp], fill=(124, 92, 255, 28), width=1)
        
    # Vertical server rack pillars receding
    for depth in [0.9, 0.75, 0.6, 0.45, 0.35, 0.25]:
        dx = int((w / 2) * depth)
        y_top = int(vp[1] - (h/2) * depth)
        y_bottom = int(vp[1] + (h/2) * depth)
        # Left rack
        draw.line([(vp[0] - dx, y_top), (vp[0] - dx, y_bottom)], fill=(255, 255, 255, int(80 * depth)), width=2)
        # Right rack
        draw.line([(vp[0] + dx, y_top), (vp[0] + dx, y_bottom)], fill=(255, 255, 255, int(80 * depth)), width=2)
        # LED rack status indicators
        for i in range(5):
            led_y = y_top + int((y_bottom - y_top) * (0.2 + i * 0.15))
            draw.rectangle([vp[0] - dx - 3, led_y - 2, vp[0] - dx + 3, led_y + 2], fill=(96, 165, 250, int(200 * depth)))
            draw.rectangle([vp[0] + dx - 3, led_y - 2, vp[0] + dx + 3, led_y + 2], fill=(34, 197, 94, int(200 * depth)))

    bg.convert("RGB").save(path, quality=95)

if __name__ == "__main__":
    import os
    out_dir = r"c:\Users\zaika\OneDrive\Desktop\OmniIdeation\frontend\src\assets\landing"
    generate_tile_intent(os.path.join(out_dir, "tile-intent.jpg"))
    generate_tile_optimize(os.path.join(out_dir, "tile-optimize.jpg"))
    generate_tile_repair(os.path.join(out_dir, "tile-repair.jpg"))
    generate_shared_brief(os.path.join(out_dir, "shared-brief.jpg"))
    generate_closing_hall(os.path.join(out_dir, "closing-hall.jpg"))
    print("Generated all landing assets successfully!")
