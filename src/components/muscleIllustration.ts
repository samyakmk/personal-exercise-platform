import type { Muscle } from '../muscleWork';

export type BodyView = 'Front' | 'Back';

// Each path describes the left half of the figure, as viewed on screen.
export const outline = 'M 92 5 C 79 5 74 14 75 25 L 76 33 Q 78 42 83 46 L 82 49 C 76 52 69 53 60 56 C 49 58 44 64 42 76 L 35 111 Q 30 122 30 135 L 23 173 Q 18 182 16 192 L 14 203 Q 14 208 17 206 L 22 194 L 20 212 Q 20 217 24 214 L 31 193 Q 34 188 34 178 L 46 143 Q 51 134 51 124 L 59 96 Q 62 112 68 127 Q 69 139 63 151 Q 56 165 58 183 C 57 202 62 224 64 245 Q 64 253 62 264 C 60 280 66 297 66 311 L 64 319 Q 61 325 55 328 Q 51 332 56 334 L 76 334 Q 82 334 81 327 L 80 317 C 80 306 84 285 84 269 Q 83 255 86 245 L 91 192 Q 92 188 92 188';

export const contours: Record<BodyView, string[]> = {
  Front: [
    'M 79 20 Q 82 17 87 19 M 81 25 Q 84 24 87 25 M 91 26 L 89 33 L 92 34 M 87 39 Q 89 40 92 40',
    'M 81 53 Q 85 57 91 57 M 60 91 Q 68 97 78 94 M 45 123 L 38 142',
    'M 68 241 Q 72 236 78 240 Q 83 246 77 253 Q 70 256 68 250 Z M 77 261 Q 73 278 74 300 M 63 329 L 73 325',
  ],
  Back: [
    'M 77 29 Q 81 36 84 38 Q 88 40 92 40 M 85 43 L 85 51 M 89 84 L 89 121 M 48 115 L 42 134',
    'M 91 155 Q 92 174 88 185 M 66 242 Q 72 246 83 243 M 76 301 L 75 321 M 64 329 L 73 326',
  ],
};

type Region = { muscle: Muscle; path: string };

export const regions: Record<BodyView, Region[]> = {
  Front: [
    { muscle: 'Neck', path: 'M 84 47 Q 87 49 91 49 L 91 57 Q 86 56 81 53 Z' },
    { muscle: 'Shoulders', path: 'M 59 59 Q 66 58 71 62 C 66 68 60 78 56 87 L 46 96 Q 44 89 46 76 Q 48 64 59 59 Z' },
    { muscle: 'Chest', path: 'M 74 62 Q 83 59 91 62 L 91 85 Q 80 93 62 87 C 64 77 66 71 74 62 Z' },
    { muscle: 'Biceps', path: 'M 57 90 Q 57 97 54 107 L 49 121 Q 45 128 40 125 Q 37 121 41 112 L 45 101 Z' },
    { muscle: 'Abdominals', path: 'M 88 89 Q 83 93 76 94 L 77 107 Q 78 120 74 131 Q 81 144 85 148 Q 90 152 91 158 L 91 92 Z M 74 96 Q 69 96 65 92 Q 65 106 71 124 Q 74 120 75 110 Z' },
    { muscle: 'Forearms', path: 'M 37 128 Q 40 133 47 129 L 30 178 L 25 177 Q 29 164 31 151 Q 31 140 37 128 Z' },
    { muscle: 'Abductors', path: 'M 68 137 Q 73 143 73 155 Q 70 169 62 184 Q 58 168 64 154 Z' },
    { muscle: 'Adductors', path: 'M 88 167 Q 92 173 91 185 L 86 225 Q 84 213 81 205 Q 77 190 82 179 Z' },
    { muscle: 'Quadriceps', path: 'M 75 155 Q 75 152 80 153 L 87 163 Q 80 179 78 190 Q 76 197 81 211 Q 86 228 80 237 Q 73 232 67 240 Q 60 215 61 189 Q 69 173 75 155 Z' },
    { muscle: 'Calves', path: 'M 65 253 Q 67 258 72 259 Q 67 277 71 303 L 68 310 Q 66 293 63 282 Q 61 268 65 253 Z' },
  ],
  Back: [
    { muscle: 'Neck', path: 'M 84 42 Q 88 44 91 44 L 91 56 L 86 54 L 82 51 Z' },
    { muscle: 'Traps', path: 'M 81 53 Q 86 56 91 58 L 91 96 Q 84 83 73 78 Q 68 73 61 59 Q 73 58 81 53 Z' },
    { muscle: 'Shoulders', path: 'M 59 60 Q 63 72 72 79 Q 63 82 57 89 Q 51 93 45 94 Q 45 88 47 75 Q 48 65 59 60 Z' },
    { muscle: 'Mid-back', path: 'M 73 81 Q 85 87 91 100 L 91 121 Q 77 112 70 101 L 66 90 Q 69 85 73 81 Z' },
    { muscle: 'Lats', path: 'M 63 89 Q 66 101 72 108 Q 79 117 87 122 Q 82 128 77 137 Q 71 130 69 120 Q 63 106 61 93 Z' },
    { muscle: 'Triceps', path: 'M 57 92 Q 56 107 49 123 Q 46 129 39 125 Q 37 120 40 109 L 44 98 Q 51 97 57 92 Z' },
    { muscle: 'Forearms', path: 'M 37 128 Q 41 131 47 129 L 31 177 L 25 177 Q 30 162 30 149 Q 33 138 37 128 Z' },
    { muscle: 'Lower back', path: 'M 91 124 L 91 152 Q 83 147 75 150 Q 72 151 69 154 Q 74 146 75 142 Q 81 130 88 123 Z' },
    { muscle: 'Abductors', path: 'M 67 151 Q 73 145 79 147 Q 71 155 67 166 L 60 176 Q 60 161 67 151 Z' },
    { muscle: 'Glutes', path: 'M 80 150 Q 87 150 91 155 L 90 178 Q 86 190 75 191 Q 66 189 61 181 Q 66 169 71 160 Q 75 153 80 150 Z' },
    { muscle: 'Adductors', path: 'M 88 187 L 90 187 L 86 224 Q 83 219 81 205 Q 80 198 82 193 Z' },
    { muscle: 'Hamstrings', path: 'M 61 186 Q 67 194 78 194 Q 78 209 84 225 L 84 240 Q 79 242 75 233 Q 72 244 67 240 Q 63 223 61 209 Z' },
    { muscle: 'Calves', path: 'M 67 247 Q 72 252 76 249 Q 80 247 83 247 Q 82 255 83 264 C 83 285 78 292 75 303 L 70 308 Q 69 293 65 279 Q 63 264 67 247 Z' },
  ],
};
