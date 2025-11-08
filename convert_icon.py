#!/usr/bin/env python3
"""
Convert PNG icon to ICO format for Windows exe
"""
from PIL import Image
import os

# Input and output paths
png_path = os.path.join('assets', 'icons', 'main-icon.png')
ico_path = os.path.join('assets', 'icons', 'app_icon.ico')

# Load PNG image
img = Image.open(png_path)

# Convert RGBA to RGB if necessary (ICO supports RGBA but some sizes work better with RGB)
if img.mode == 'RGBA':
    # Create multiple sizes for better Windows compatibility
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

    # Save as ICO with multiple sizes
    img.save(ico_path, format='ICO', sizes=sizes)
    print(f"✓ Created {ico_path} with sizes: {sizes}")
else:
    # If not RGBA, convert to RGBA first
    img = img.convert('RGBA')
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico_path, format='ICO', sizes=sizes)
    print(f"✓ Created {ico_path} with sizes: {sizes}")

print("Icon conversion complete!")
