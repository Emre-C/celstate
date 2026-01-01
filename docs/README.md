# Celstate Documentation

## Overview

Celstate is an AI-powered media creation platform designed for autonomous AI agents to generate transparent UI assets.

## Documentation Structure

### [Research & Technical Documentation](./research/)
- **[Implementation Plan](./research/implementation_plan.md)** - Video difference matting feasibility research
- **[Research Notes](./research/research.md)** - Technical research and experimentation notes

### [Engine Documentation](../src/engine/)
- **[Core Engine](../src/engine/core/)** - Production-ready media generation logic
- **[Experimental Code](../src/engine/experiments/)** - Debug scripts and experimental features

## Quick Start

1. Install dependencies: `uv sync`
2. Start development server: `uv run dev`
3. Access API docs: `http://localhost:8000/docs`

## Architecture

The system follows an "Agent-First" architecture optimized for autonomous AI coders:

- **Core Logic**: Isolated in `src/engine/core/` (pure Python, no CLI/VENV logic)
- **Job Persistence**: Uses flat-file 'Job Store' in `var/jobs/{id}/job.json`
- **API**: FastAPI-based async jobs with MCP server support
- **Artifacts**: Served statically via the API

For detailed API documentation, see the main [README.md](../README.md).
