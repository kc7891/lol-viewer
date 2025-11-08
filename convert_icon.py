#!/usr/bin/env python3
"""
Convert PNG icon to ICO format for Windows exe
Creates ICO with multiple sizes for PyInstaller compatibility
"""
from PIL import Image
import os

# Input and output paths
png_path = os.path.join('assets', 'icons', 'main-icon.png')
ico_path = os.path.join('assets', 'icons', 'app_icon.ico')

# Load PNG image
img = Image.open(png_path)

# Convert to RGBA for transparency support
if img.mode != 'RGBA':
    img = img.convert('RGBA')

# Windows ICO standard sizes
# Use smaller sizes only for better PyInstaller compatibility
# Larger sizes (>= 128) can cause issues with PNG compression in ICO
sizes = [(16, 16), (24, 24), (32, 32), (48, 48)]

print(f"Converting {png_path} to ICO format...")
print(f"Original image size: {img.size}")
print(f"Target sizes: {sizes}")

# Save as ICO with multiple sizes
# Pillow will automatically handle the format
img.save(ico_path, format='ICO', sizes=sizes)

# Verify the file was created
if os.path.exists(ico_path):
    file_size = os.path.getsize(ico_path)
    print(f"✓ Created {ico_path}")
    print(f"  File size: {file_size:,} bytes")
    print(f"  Sizes: {len(sizes)} variants")
else:
    print(f"✗ Failed to create {ico_path}")

print("Icon conversion complete!")
