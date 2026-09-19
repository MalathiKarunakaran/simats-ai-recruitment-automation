"""Text primitives shared by the two poster renderers (2026-09-18).

Extracted from `job_poster` when `campaign_poster` needed the same two
things. `pdf_text` in particular is not a convenience: reportlab's built-in
Helvetica only covers Windows-1252, so a rupee sign or a Tamil word prints
as a black box unless it is folded first. Two copies of that rule would
drift, and the drift would only show up on a printed sheet.
"""

import io

from PIL import Image
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen.canvas import Canvas


def pdf_text(value: object) -> str:
    """Fold a string into what the built-in fonts can actually draw."""
    text = str(value).replace("₹", "Rs. ")
    return text.encode("cp1252", errors="replace").decode("cp1252")


def paragraph(
    canvas: Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    size: float,
    leading: float,
    max_lines: int,
    color,
    font: str = "Helvetica",
) -> float:
    """Draws wrapped text and returns the baseline below it. Text that does
    not fit is truncated with an ellipsis rather than overrunning the box --
    a poster has a fixed size and something has to give."""
    lines = simpleSplit(pdf_text(text), font, size, width)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" .,") + "..."
    canvas.setFillColor(color)
    canvas.setFont(font, size)
    for line in lines:
        canvas.drawString(x, y, line)
        y -= leading
    return y


def cover_image(png: bytes, aspect: float) -> ImageReader | None:
    """Centre-crops an image to fill a box of the given aspect ratio.

    No size the image model offers matches a poster band (about 3.5:1) or a
    role card (about 2.7:1), so drawing one straight into its box squashes it.
    Cropping to fill is what a designer would do by hand.

    An image that cannot be read at all returns None, and the caller draws
    whatever it drew before there was a picture -- a broken file must never
    cost somebody the poster.
    """
    try:
        image = Image.open(io.BytesIO(png))
        image.load()
    except (OSError, ValueError):
        return None
    if image.width / image.height >= aspect:
        target_width, target_height = round(image.height * aspect), image.height
    else:
        target_width, target_height = image.width, round(image.width / aspect)
    left = (image.width - target_width) // 2
    top = (image.height - target_height) // 2
    cropped = image.convert("RGB").crop((left, top, left + target_width, top + target_height))
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)
