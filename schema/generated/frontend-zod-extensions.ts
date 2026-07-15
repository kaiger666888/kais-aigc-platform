// AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.
// Run `python schema/generate_mappings.py` to regenerate.

export type ZodFieldType = "string" | "number";

export interface YamlOptionalField {
  key: string;
  zodType: ZodFieldType;
}

export const YAML_OPTIONAL_FIELDS: Record<string, YamlOptionalField[]> = {
  "script": [
    {
      "key": "hookType",
      "zodType": "string"
    },
    {
      "key": "hookIntensity",
      "zodType": "number"
    },
    {
      "key": "totalDuration",
      "zodType": "string"
    },
    {
      "key": "genre",
      "zodType": "string"
    },
    {
      "key": "tone",
      "zodType": "string"
    },
    {
      "key": "total_duration_sec",
      "zodType": "string"
    },
    {
      "key": "mcmahonArc",
      "zodType": "string"
    },
    {
      "key": "cameraMovement",
      "zodType": "string"
    },
    {
      "key": "framing",
      "zodType": "string"
    },
    {
      "key": "composition",
      "zodType": "string"
    },
    {
      "key": "pacing",
      "zodType": "string"
    },
    {
      "key": "timeline",
      "zodType": "string"
    },
    {
      "key": "axisLine",
      "zodType": "string"
    },
    {
      "key": "audioCue",
      "zodType": "string"
    },
    {
      "key": "ltxPrompt",
      "zodType": "string"
    },
    {
      "key": "shot_type",
      "zodType": "string"
    }
  ],
  "asset": [
    {
      "key": "archetype",
      "zodType": "string"
    },
    {
      "key": "ageRange",
      "zodType": "string"
    },
    {
      "key": "era",
      "zodType": "string"
    },
    {
      "key": "style_composition",
      "zodType": "number"
    },
    {
      "key": "style_color",
      "zodType": "number"
    },
    {
      "key": "style_rhythm",
      "zodType": "number"
    },
    {
      "key": "style_light",
      "zodType": "number"
    },
    {
      "key": "style_sound",
      "zodType": "number"
    }
  ],
  "storyboard": [
    {
      "key": "cameraMovement",
      "zodType": "string"
    },
    {
      "key": "framing",
      "zodType": "string"
    },
    {
      "key": "composition",
      "zodType": "string"
    },
    {
      "key": "pacing",
      "zodType": "string"
    },
    {
      "key": "timeline",
      "zodType": "string"
    },
    {
      "key": "axisLine",
      "zodType": "string"
    },
    {
      "key": "audioCue",
      "zodType": "string"
    },
    {
      "key": "ltxPrompt",
      "zodType": "string"
    }
  ],
  "audio": [
    {
      "key": "audioType",
      "zodType": "string"
    },
    {
      "key": "engine",
      "zodType": "string"
    },
    {
      "key": "emotion",
      "zodType": "string"
    },
    {
      "key": "speaker",
      "zodType": "string"
    }
  ],
  "video": [
    {
      "key": "engine",
      "zodType": "string"
    },
    {
      "key": "resolution",
      "zodType": "string"
    },
    {
      "key": "duration",
      "zodType": "number"
    },
    {
      "key": "murchGrade",
      "zodType": "string"
    }
  ]
};
