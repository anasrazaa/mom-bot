"""Document export routes (DOCX + PDF)."""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from loguru import logger

from app.modules.pipeline import pipeline_manager

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/{meeting_id}/docx", summary="Download MoM as DOCX")
async def export_docx(meeting_id: str):
    try:
        path: Path = await pipeline_manager.export_docx(meeting_id)
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        logger.error(f"DOCX export failed: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))

    return FileResponse(
        path=str(path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=path.name,
    )


@router.get("/{meeting_id}/pdf", summary="Download MoM as PDF")
async def export_pdf(meeting_id: str):
    try:
        path: Path = await pipeline_manager.export_pdf(meeting_id)
    except KeyError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        logger.error(f"PDF export failed: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))

    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=path.name,
    )
