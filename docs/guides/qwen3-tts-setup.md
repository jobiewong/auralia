# Qwen3-TTS setup

Auralia runs Qwen3-TTS locally through an isolated Python environment. The web app never calls Qwen directly; it sends requests to FastAPI, and FastAPI launches the configured Qwen Python interpreter for preview generation and synthesis.

## 1. Create the conda environment

If `conda` is not installed, install Miniconda first. On Linux/WSL:

```bash
mkdir -p ~/miniconda3
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O ~/miniconda3/miniconda.sh
bash ~/miniconda3/miniconda.sh -b -u -p ~/miniconda3
rm ~/miniconda3/miniconda.sh
~/miniconda3/bin/conda init zsh
```

Restart the shell after `conda init`. Use `conda init bash` instead if your shell is Bash.

Run these commands from any directory — the Qwen environment does not need to live inside the Auralia repo:

```bash
conda create -n qwen3-tts python=3.12 -y
conda activate qwen3-tts
python -m pip install --upgrade pip
pip install -U qwen-tts soundfile
conda install -c conda-forge sox -y
```

`sox` is needed by Qwen's audio stack. Installing it into the conda environment keeps the setup self-contained.

## 2. Configure Auralia

Set these values in the repo-root `.env`:

```env
AURALIA_QWEN_TTS_PYTHON=/home/jobie/miniconda3/envs/qwen3-tts/bin/python
AURALIA_QWEN_TTS_VOICE_DESIGN_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign
AURALIA_QWEN_TTS_VOICE_CLONE_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base
AURALIA_QWEN_TTS_DEVICE=cuda:0
AURALIA_QWEN_TTS_DTYPE=bfloat16
AURALIA_QWEN_TTS_DEFAULT_LANGUAGE=English
AURALIA_QWEN_TTS_TIMEOUT_SECONDS=300
AURALIA_QWEN_TTS_NUMBA_CACHE_DIR=/tmp/auralia-numba-cache
```

Change `AURALIA_QWEN_TTS_PYTHON` if Miniconda is installed somewhere else. The path must point to the Python executable inside the Qwen environment, not Auralia's project `.venv`.

For CPU-only testing:

```env
AURALIA_QWEN_TTS_DEVICE=cpu
AURALIA_QWEN_TTS_DTYPE=float32
```

CPU generation works but is significantly slower.

## 3. Verify the environment

```bash
NUMBA_CACHE_DIR=/tmp/auralia-numba-cache \
PATH=/home/jobie/miniconda3/envs/qwen3-tts/bin:$PATH \
/home/jobie/miniconda3/envs/qwen3-tts/bin/python -c "import torch; print(torch.cuda.is_available()); import qwen_tts; print('qwen ok')"
```

Expected CUDA output:

```
True
qwen ok
```

If it prints a FlashAttention warning, that is not fatal — Auralia retries model loading without FlashAttention automatically.

If it prints `False`, PyTorch cannot see CUDA in the Qwen environment. Fix the CUDA/driver/WSL setup before using `AURALIA_QWEN_TTS_DEVICE=cuda:0`.

If it fails with a Numba/librosa cache error, confirm `NUMBA_CACHE_DIR=/tmp/auralia-numba-cache` is set and the directory is writable.

## 4. First preview run

Start Auralia from the repo root:

```bash
npm run dev
```

Create a designed voice in `/voices` and click Generate Preview. The FastAPI terminal should show:

```
[qwen-tts] importing runtime packages
[qwen-tts] torch cuda_available=True device=cuda:0
[qwen-tts] loading model Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign
[qwen-tts] generating voice design preview temperature=0.9
[qwen-tts] wrote data/voices/<voice_id>/previews/<file>.wav
```

The first run may download model weights from Hugging Face. Later runs reuse the local cache. Set `AURALIA_QWEN_TTS_VOICE_DESIGN_MODEL` to a local directory path to run fully offline after the initial download.

## 5. FlashAttention (optional)

FlashAttention can improve generation speed and VRAM usage on compatible hardware. Try it only after baseline preview generation works:

```bash
conda activate qwen3-tts
pip install packaging ninja
MAX_JOBS=1 NVCC_THREADS=1 pip install flash-attn --no-build-isolation --no-cache-dir
```

Builds can fail on newer Python/PyTorch/CUDA combinations if no matching wheel exists, or if compilation runs out of memory. Leave FlashAttention uninstalled if it fails — Auralia retries model loading without it.

## References

- [Qwen3-TTS GitHub](https://github.com/QwenLM/Qwen3-TTS)
- [qwen-tts on PyPI](https://pypi.org/project/qwen-tts/)
