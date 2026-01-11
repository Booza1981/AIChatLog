#!/usr/bin/env python3
"""
Generate simple placeholder icons for the extension
"""

from PIL import Image, ImageDraw, ImageFont

def create_icon(size):
    # Create blue gradient background
    img = Image.new('RGB', (size, size), color='#3b82f6')
    draw = ImageDraw.Draw(img)

    # Draw chat bubble shape
    padding = size // 4
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=size // 8,
        fill='white'
    )

    # Draw three dots (chat indicator)
    dot_size = size // 12
    center_y = size // 2
    spacing = size // 6

    for i in range(3):
        x = padding + spacing + (i * spacing)
        draw.ellipse(
            [x - dot_size, center_y - dot_size, x + dot_size, center_y + dot_size],
            fill='#3b82f6'
        )

    return img

# Generate icons at different sizes
sizes = [16, 48, 128]
for size in sizes:
    img = create_icon(size)
    img.save(f'icons/icon{size}.png')
    print(f'Created icon{size}.png')
