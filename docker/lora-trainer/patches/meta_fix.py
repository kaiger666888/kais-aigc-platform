import torch
import torch.nn as nn

_original_to = nn.Module.to

def _patched_to(self, *args, **kwargs):
    device = None
    for arg in args:
        if isinstance(arg, torch.device) or (isinstance(arg, str)):
            device = torch.device(arg) if isinstance(arg, str) else arg
    if "device" in kwargs:
        device = kwargs["device"] if isinstance(kwargs["device"], torch.device) else torch.device(kwargs["device"])
    
    if device is not None and device.type != "meta":
        try:
            return nn.Module.to_empty(self, device=device).to(*args, **kwargs)
        except Exception:
            pass
    
    return _original_to(self, *args, **kwargs)

nn.Module.to = _patched_to
try:
    import huggingface_hub
    if not hasattr(huggingface_hub, 'is_offline_mode'):
        from huggingface_hub.utils import is_offline_mode
        huggingface_hub.is_offline_mode = is_offline_mode
except ImportError:
    pass
