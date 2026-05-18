"""PDF extraction service."""

from PyPDF2 import PdfReader
from io import BytesIO


def extract_text_from_pdf(pdf_content: bytes) -> str:
    """
    Extract text from a PDF file.
    
    Args:
        pdf_content: Raw bytes of the PDF file
        
    Returns:
        Extracted text from all pages
    """
    try:
        pdf_file = BytesIO(pdf_content)
        reader = PdfReader(pdf_file)
        
        extracted_text = []
        for page_num, page in enumerate(reader.pages, 1):
            # Extract text from page
            text = page.extract_text()
            if text:
                # Add page marker for context
                extracted_text.append(f"# Page {page_num}\n\n{text}")
        
        return "\n\n".join(extracted_text)
    except Exception as e:
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")
