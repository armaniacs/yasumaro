from PIL import Image, ImageOps, ImageDraw

def create_header_image():
    # Canvas setup
    canvas_w, canvas_h = 1280, 670
    bg_color = (250, 250, 250) # Light gray background
    img = Image.new('RGB', (canvas_w, canvas_h), color=bg_color)
    
    # Load assets
    base_path = "docs/blog-2_2_2/"
    try:
        icon = Image.open(base_path + "icon.png").convert("RGBA")
        ss_main = Image.open(base_path + "screenshot_main.png").convert("RGBA")
        ss_obsidian = Image.open(base_path + "screenshot_obsidian.png").convert("RGBA")
        ss_ublock = Image.open(base_path + "screenshot_ublock.png").convert("RGBA")
    except FileNotFoundError as e:
        print(f"Error loading images: {e}")
        return

    # Resize/Process assets
    
    # 1. Icon: Place it on the top left or center? 
    # Let's make a layout:
    # Left side: Icon (branding)
    # Right side: Collage of screenshots
    
    # Resize Icon
    icon_size = 200
    icon = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    
    # Place Icon
    # Center vertically on the left third?
    # Or maybe top center with screenshots below?
    
    # Let's try a "Features" layout.
    # Background: Subtle pattern or solid
    
    # Screenshot layout:
    # Main screenshot is the "hero".
    # Obsidian is the "result".
    # uBlock is "feature".
    
    # Let's resize screenshots to fit nicely.
    # Target height for main screenshots ~400px
    
    def resize_contain(image, max_w, max_h):
        ratio = min(max_w / image.width, max_h / image.height)
        new_size = (int(image.width * ratio), int(image.height * ratio))
        return image.resize(new_size, Image.Resampling.LANCZOS)

    # Main Screenshot (Popup) - Make it prominent
    ss_main_resized = resize_contain(ss_main, 600, 500)
    
    # Obsidian Screenshot (Result)
    ss_obsidian_resized = resize_contain(ss_obsidian, 500, 400)
    
    # uBlock Screenshot (Feature)
    ss_ublock_resized = resize_contain(ss_ublock, 400, 350)
    
    # Add shadows (simulate)
    def add_shadow(image, offset=10, shadow_color=(0,0,0,50)):
        back = Image.new('RGBA', (image.width + offset, image.height + offset), (0,0,0,0))
        draw = ImageDraw.Draw(back)
        draw.rectangle([offset, offset, image.width+offset, image.height+offset], fill=shadow_color)
        # Blur could be done with a filter but simple offset is okay for now or we can use BoxBlur if we import ImageFilter
        from PIL import ImageFilter
        back = back.filter(ImageFilter.GaussianBlur(10))
        
        # Paste image over shadow
        back.paste(image, (0,0), image)
        return back

    from PIL import ImageFilter # Import here just in case

    # Apply shadows
    ss_main_final = add_shadow(ss_main_resized)
    ss_obsidian_final = add_shadow(ss_obsidian_resized)
    ss_ublock_final = add_shadow(ss_ublock_resized)
    
    # Compostion
    
    # 1. Icon - Top Left branding
    img.paste(icon, (50, 50), icon)
    
    # 2. Main Screenshot - Center Left (overlapping icon slightly?) OR just below text? 
    # Let's put Icon top-left.
    # Text "Obsidian Smart History" could be added but user didn't provide font.
    # We rely on visuals.
    
    # Layout Idea:
    # Icon top-left (padding 40)
    # Main SS: Center-Left
    # uBlock SS: Bottom-Right (overlapping Main)
    # Obsidian SS: Top-Right (overlapping Main)
    
    # Coordinates
    
    # Main SS
    main_x = 100
    main_y = 150
    img.paste(ss_main_final, (main_x, main_y), ss_main_final)
    
    # Obsidian SS (Result) - Top Right
    obs_x = 650
    obs_y = 50
    img.paste(ss_obsidian_final, (obs_x, obs_y), ss_obsidian_final)
    
    # uBlock SS - Bottom Right
    ub_x = 750
    ub_y = 300
    img.paste(ss_ublock_final, (ub_x, ub_y), ss_ublock_final)

    # Add a title text? "v2.2 Update" if possible?
    # Without font file, default font is ugly. Let's stick to images.
    
    # Save
    output_path = base_path + "header_image.png"
    img.save(output_path)
    print(f"Created header image at {output_path}")

if __name__ == "__main__":
    create_header_image()
