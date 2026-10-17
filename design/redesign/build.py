"""Inline shared sample data into each mockup: src/*.html -> *.html."""
import pathlib
here = pathlib.Path(__file__).parent
data = (here / "src/data.js").read_text()
for src in sorted((here / "src").glob("*.html")):
    (here / src.name).write_text(src.read_text().replace("/*DATA*/", data))
    print("built", src.name)
