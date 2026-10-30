/**
 * cik — el modelo de IA que vive en Monad (contratos `Ci`, `CiView`, `CiRisk`), y
 * `CiGuardV2`, la capa de política que cada protocolo despliega con sus umbrales.
 *
 * Direcciones de la v2 (26 de octubre de 2026), código verificado en Sourcify: red
 * 256 → 384 → 192 → 4, features v5 y datos de Monad. La sonda y el registro de
 * símbolos son los de la v1.0, que la v2 reutiliza. La v1.1 (22-oct) y la v1.0
 * (21-oct) siguen en la cadena, que no deja retirarlas; la v1.0 no sigue los
 * proxies EIP-1167 y con ella $PANAL salía «drainer». No usarlas.
 *
 * `CiGuardV2` no está desplegado: cada protocolo despliega el suyo. La página lo
 * EJECUTA sin desplegarlo (un `eth_call` con el bytecode de creación), así que lo que
 * ve quien prueba una política es el contrato de verdad, no una imitación en
 * TypeScript. El bytecode sale del repositorio de cik (commit 9ce3598, el de la v2;
 * solc 0.8.28, via-ir, optimizer 1 run, sin hash de metadatos); su keccak256 va abajo
 * para poder comprobarlo.
 *
 * ABIs recortadas a lo que usa la web, generadas de los artefactos compilados.
 * `check` y `evidenceOf` de `Ci` NO son view —la sonda hace un préstamo que
 * siempre revierte— pero no cambian estado: aquí se declaran view para leerlas
 * con `readContract` por `eth_call`, que es como se usan.
 */

import type { Address, Hex } from 'viem';

export const CIK = {
  ci: '0x960aF5B6dC9Bcf30E19d22390D17Ac70A6800d14' as Address,
  view: '0x6EA6Bb12fD7CdC48F9D5bA45db2900eEebDb7f02' as Address,
  risk: '0x731d1060A57f792191A825FE7d858B24541A9209' as Address,
  models: '0x6c1E50DbD363e2BAf2078B407D92573eaab4029d' as Address,
  probe: '0x70c9F91242ca79706E271e7e7d404f47195681ea' as Address,
  clones: '0x191E70B4Cf97B002d0c571b9CAC9789b20Cfd713' as Address,
  symbols: '0x4C19b3e2dc556191b9ACaC53C5cef3C5147D9B12' as Address,
  /** Delegaciones EIP-7702 (30-oct-2026): a quién se entrega una cuenta y si es un barredor. */
  delegate: '0x5d638406A55062309B84152d4Ab9092420980547' as Address,
} as const;

/** Lo que se ve en Sourcify: el código fuente de cada contrato con su bytecode. */
export const SOURCIFY = (a: Address) => `https://repo.sourcify.dev/143/${a}`;

export const ciAbi = [
  {
    'type': 'function',
    'name': 'featuresOf',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': 'f',
        'type': 'bytes'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'MODEL_HASH',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'IN0',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'OUT0',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'IN1',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'OUT1',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'IN2',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'OUT2',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'attest',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      },
      {
        'name': 'classId',
        'type': 'uint8'
      },
      {
        'name': 'evidenceHash',
        'type': 'bytes32'
      }
    ],
    'outputs': [
      {
        'name': 'key',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'payable'
  },
  {
    'type': 'function',
    'name': 'attest',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      },
      {
        'name': 'classId',
        'type': 'uint8'
      }
    ],
    'outputs': [
      {
        'name': 'key',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'payable'
  },
  {
    'type': 'function',
    'name': 'challenge',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [],
    'stateMutability': 'payable'
  },
  {
    'type': 'function',
    'name': 'challengeBond',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'challengeWindow',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'check',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'cloneCount',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'codeOf',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bytes'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'evidenceOf',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': 'm',
        'type': 'tuple',
        'components': [
          {
            'name': 'name',
            'type': 'bytes32'
          },
          {
            'name': 'symbol',
            'type': 'bytes32'
          },
          {
            'name': 'nameLen',
            'type': 'uint8'
          },
          {
            'name': 'symLen',
            'type': 'uint8'
          }
        ]
      },
      {
        'name': 'r',
        'type': 'tuple',
        'components': [
          {
            'name': 'hasPair',
            'type': 'bool'
          },
          {
            'name': 'bought',
            'type': 'bool'
          },
          {
            'name': 'sold',
            'type': 'bool'
          },
          {
            'name': 'movable',
            'type': 'bool'
          },
          {
            'name': 'buyKeptBps',
            'type': 'uint16'
          },
          {
            'name': 'sellKeptBps',
            'type': 'uint16'
          },
          {
            'name': 'venue',
            'type': 'uint8'
          }
        ]
      },
      {
        'name': 'evidenceHash',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'extractFeatures',
    'inputs': [
      {
        'name': 'code',
        'type': 'bytes'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bytes'
      }
    ],
    'stateMutability': 'pure'
  },
  {
    'type': 'function',
    'name': 'getVerdict',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': 'attestor',
        'type': 'address'
      },
      {
        'name': 'postedAt',
        'type': 'uint64'
      },
      {
        'name': 'stake',
        'type': 'uint96'
      },
      {
        'name': 'classId',
        'type': 'uint8'
      },
      {
        'name': 'challenged',
        'type': 'bool'
      },
      {
        'name': 'exists',
        'type': 'bool'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'honeypotProbe',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'infer',
    'inputs': [
      {
        'name': 'features',
        'type': 'bytes'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'isFinal',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'keyFor',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bytes32'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'lookup',
    'inputs': [
      {
        'name': 'features',
        'type': 'bytes'
      }
    ],
    'outputs': [
      {
        'name': 'found',
        'type': 'bool'
      },
      {
        'name': 'classId',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'minStake',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'symbolCount',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'verify',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': 'classId',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'verifyCode',
    'inputs': [
      {
        'name': 'code',
        'type': 'bytes'
      }
    ],
    'outputs': [
      {
        'name': 'classId',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'withdraw',
    'inputs': [
      {
        'name': 'key',
        'type': 'bytes32'
      }
    ],
    'outputs': [],
    'stateMutability': 'nonpayable'
  },
  {
    'type': 'error',
    'name': 'ActiveVerdict',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'AlreadyChallenged',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'BadBond',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'BadClass',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'BadStake',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'MetaChanged',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'NoVerdict',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'NotAttestor',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'NotFinal',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'ProbeFailed',
    'inputs': []
  },
  {
    'type': 'error',
    'name': 'StaleWindow',
    'inputs': []
  }
] as const;

export const ciViewAbi = [
  {
    'type': 'function',
    'name': 'inspect',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      },
      {
        'name': 'pair',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'tuple',
        'components': [
          {
            'name': 'modelClass',
            'type': 'uint8'
          },
          {
            'name': 'cloneHit',
            'type': 'bool'
          },
          {
            'name': 'cloneClass',
            'type': 'uint8'
          },
          {
            'name': 'hasSymbol',
            'type': 'bool'
          },
          {
            'name': 'scamWord',
            'type': 'bool'
          },
          {
            'name': 'nonAscii',
            'type': 'bool'
          },
          {
            'name': 'othersWithSymbol',
            'type': 'uint8'
          },
          {
            'name': 'symbolLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'nameLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'symbolScam',
            'type': 'bool'
          },
          {
            'name': 'liquidity',
            'type': 'uint256'
          },
          {
            'name': 'top1Bps',
            'type': 'uint256'
          },
          {
            'name': 'top10Bps',
            'type': 'uint256'
          },
          {
            'name': 'lpBurnedBps',
            'type': 'uint256'
          },
          {
            'name': 'riskScore',
            'type': 'uint16'
          },
          {
            'name': 'riskLevel',
            'type': 'uint8'
          },
          {
            'name': 'riskFlags',
            'type': 'uint16'
          },
          {
            'name': 'modelHash',
            'type': 'bytes32'
          },
          {
            'name': 'source',
            'type': 'uint8'
          },
          {
            'name': 'runnerUp',
            'type': 'uint8'
          },
          {
            'name': 'margin',
            'type': 'uint256'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'inspect',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      },
      {
        'name': 'pair',
        'type': 'address'
      },
      {
        'name': 'holders',
        'type': 'address[]'
      }
    ],
    'outputs': [
      {
        'name': 'r',
        'type': 'tuple',
        'components': [
          {
            'name': 'modelClass',
            'type': 'uint8'
          },
          {
            'name': 'cloneHit',
            'type': 'bool'
          },
          {
            'name': 'cloneClass',
            'type': 'uint8'
          },
          {
            'name': 'hasSymbol',
            'type': 'bool'
          },
          {
            'name': 'scamWord',
            'type': 'bool'
          },
          {
            'name': 'nonAscii',
            'type': 'bool'
          },
          {
            'name': 'othersWithSymbol',
            'type': 'uint8'
          },
          {
            'name': 'symbolLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'nameLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'symbolScam',
            'type': 'bool'
          },
          {
            'name': 'liquidity',
            'type': 'uint256'
          },
          {
            'name': 'top1Bps',
            'type': 'uint256'
          },
          {
            'name': 'top10Bps',
            'type': 'uint256'
          },
          {
            'name': 'lpBurnedBps',
            'type': 'uint256'
          },
          {
            'name': 'riskScore',
            'type': 'uint16'
          },
          {
            'name': 'riskLevel',
            'type': 'uint8'
          },
          {
            'name': 'riskFlags',
            'type': 'uint16'
          },
          {
            'name': 'modelHash',
            'type': 'bytes32'
          },
          {
            'name': 'source',
            'type': 'uint8'
          },
          {
            'name': 'runnerUp',
            'type': 'uint8'
          },
          {
            'name': 'margin',
            'type': 'uint256'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  }
] as const;

export const ciRiskAbi = [
  {
    'type': 'function',
    'name': 'minLiquidity',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'nadfunCurve',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'nadfunLiquidity',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  }
] as const;

/** La regla de honeypot de la sonda, sobre su resultado: así la decide la cadena, no la web. */
export const ciProbeAbi = [
  {
    'type': 'function',
    'name': 'honeypot',
    'inputs': [
      {
        'name': 'r',
        'type': 'tuple',
        'components': [
          {
            'name': 'hasPair',
            'type': 'bool'
          },
          {
            'name': 'bought',
            'type': 'bool'
          },
          {
            'name': 'sold',
            'type': 'bool'
          },
          {
            'name': 'movable',
            'type': 'bool'
          },
          {
            'name': 'buyKeptBps',
            'type': 'uint16'
          },
          {
            'name': 'sellKeptBps',
            'type': 'uint16'
          },
          {
            'name': 'venue',
            'type': 'uint8'
          }
        ]
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'pure'
  }
] as const;

export const ciGuardAbi = [
  {
    'type': 'constructor',
    'inputs': [
      {
        'name': '_view',
        'type': 'address'
      },
      {
        'name': '_maxRiskLevel',
        'type': 'uint8'
      },
      {
        'name': '_minLiquidity',
        'type': 'uint256'
      },
      {
        'name': '_maxTop1Bps',
        'type': 'uint256'
      },
      {
        'name': '_maxTop10Bps',
        'type': 'uint256'
      },
      {
        'name': '_blockSuspicious',
        'type': 'bool'
      },
      {
        'name': '_blockSymbolScam',
        'type': 'bool'
      },
      {
        'name': '_blockUpgradeable',
        'type': 'bool'
      },
      {
        'name': '_minOkMargin',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'nonpayable'
  },
  {
    'type': 'function',
    'name': 'check',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      },
      {
        'name': 'pair',
        'type': 'address'
      },
      {
        'name': 'holders',
        'type': 'address[]'
      }
    ],
    'outputs': [
      {
        'name': 'ok',
        'type': 'bool'
      },
      {
        'name': 'reason',
        'type': 'uint8'
      },
      {
        'name': 'rep',
        'type': 'tuple',
        'components': [
          {
            'name': 'modelClass',
            'type': 'uint8'
          },
          {
            'name': 'cloneHit',
            'type': 'bool'
          },
          {
            'name': 'cloneClass',
            'type': 'uint8'
          },
          {
            'name': 'hasSymbol',
            'type': 'bool'
          },
          {
            'name': 'scamWord',
            'type': 'bool'
          },
          {
            'name': 'nonAscii',
            'type': 'bool'
          },
          {
            'name': 'othersWithSymbol',
            'type': 'uint8'
          },
          {
            'name': 'symbolLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'nameLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'symbolScam',
            'type': 'bool'
          },
          {
            'name': 'liquidity',
            'type': 'uint256'
          },
          {
            'name': 'top1Bps',
            'type': 'uint256'
          },
          {
            'name': 'top10Bps',
            'type': 'uint256'
          },
          {
            'name': 'lpBurnedBps',
            'type': 'uint256'
          },
          {
            'name': 'riskScore',
            'type': 'uint16'
          },
          {
            'name': 'riskLevel',
            'type': 'uint8'
          },
          {
            'name': 'riskFlags',
            'type': 'uint16'
          },
          {
            'name': 'modelHash',
            'type': 'bytes32'
          },
          {
            'name': 'source',
            'type': 'uint8'
          },
          {
            'name': 'runnerUp',
            'type': 'uint8'
          },
          {
            'name': 'margin',
            'type': 'uint256'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'requireSafe',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      },
      {
        'name': 'pair',
        'type': 'address'
      },
      {
        'name': 'holders',
        'type': 'address[]'
      }
    ],
    'outputs': [
      {
        'name': 'rep',
        'type': 'tuple',
        'components': [
          {
            'name': 'modelClass',
            'type': 'uint8'
          },
          {
            'name': 'cloneHit',
            'type': 'bool'
          },
          {
            'name': 'cloneClass',
            'type': 'uint8'
          },
          {
            'name': 'hasSymbol',
            'type': 'bool'
          },
          {
            'name': 'scamWord',
            'type': 'bool'
          },
          {
            'name': 'nonAscii',
            'type': 'bool'
          },
          {
            'name': 'othersWithSymbol',
            'type': 'uint8'
          },
          {
            'name': 'symbolLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'nameLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'symbolScam',
            'type': 'bool'
          },
          {
            'name': 'liquidity',
            'type': 'uint256'
          },
          {
            'name': 'top1Bps',
            'type': 'uint256'
          },
          {
            'name': 'top10Bps',
            'type': 'uint256'
          },
          {
            'name': 'lpBurnedBps',
            'type': 'uint256'
          },
          {
            'name': 'riskScore',
            'type': 'uint16'
          },
          {
            'name': 'riskLevel',
            'type': 'uint8'
          },
          {
            'name': 'riskFlags',
            'type': 'uint16'
          },
          {
            'name': 'modelHash',
            'type': 'bytes32'
          },
          {
            'name': 'source',
            'type': 'uint8'
          },
          {
            'name': 'runnerUp',
            'type': 'uint8'
          },
          {
            'name': 'margin',
            'type': 'uint256'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'requireSafeWithProbe',
    'inputs': [
      {
        'name': 'token',
        'type': 'address'
      },
      {
        'name': 'pair',
        'type': 'address'
      },
      {
        'name': 'holders',
        'type': 'address[]'
      }
    ],
    'outputs': [
      {
        'name': 'rep',
        'type': 'tuple',
        'components': [
          {
            'name': 'modelClass',
            'type': 'uint8'
          },
          {
            'name': 'cloneHit',
            'type': 'bool'
          },
          {
            'name': 'cloneClass',
            'type': 'uint8'
          },
          {
            'name': 'hasSymbol',
            'type': 'bool'
          },
          {
            'name': 'scamWord',
            'type': 'bool'
          },
          {
            'name': 'nonAscii',
            'type': 'bool'
          },
          {
            'name': 'othersWithSymbol',
            'type': 'uint8'
          },
          {
            'name': 'symbolLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'nameLenScaled',
            'type': 'uint8'
          },
          {
            'name': 'symbolScam',
            'type': 'bool'
          },
          {
            'name': 'liquidity',
            'type': 'uint256'
          },
          {
            'name': 'top1Bps',
            'type': 'uint256'
          },
          {
            'name': 'top10Bps',
            'type': 'uint256'
          },
          {
            'name': 'lpBurnedBps',
            'type': 'uint256'
          },
          {
            'name': 'riskScore',
            'type': 'uint16'
          },
          {
            'name': 'riskLevel',
            'type': 'uint8'
          },
          {
            'name': 'riskFlags',
            'type': 'uint16'
          },
          {
            'name': 'modelHash',
            'type': 'bytes32'
          },
          {
            'name': 'source',
            'type': 'uint8'
          },
          {
            'name': 'runnerUp',
            'type': 'uint8'
          },
          {
            'name': 'margin',
            'type': 'uint256'
          }
        ]
      }
    ],
    'stateMutability': 'nonpayable'
  },
  {
    'type': 'error',
    'name': 'Unsafe',
    'inputs': [
      {
        'name': 'reason',
        'type': 'uint8'
      }
    ]
  }
] as const;

/** `CiDelegate`: el ABI sale del artefacto de raipanal (commit e56c211, el desplegado). */
export const ciDelegateAbi = [
  {
    'type': 'function',
    'name': 'FLAG_CALL',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_CHAIN',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_CREATE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_DELEGATECALL',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_LARGE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_NO_CODE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_ORIGIN',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_SELFBALANCE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_SELFDESTRUCT',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_SIGNATURE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_TOKEN_MOVE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'FLAG_USEROP',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint16'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'MAX_ONCHAIN_SCAN',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint256'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'VERDICT_KNOWN',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'VERDICT_NONE',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'VERDICT_SWEEPER',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'VERDICT_UNKNOWN',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'uint8'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'inspectAccount',
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'tuple',
        'components': [
          {
            'name': 'kind',
            'type': 'uint8'
          },
          {
            'name': 'delegate',
            'type': 'address'
          },
          {
            'name': 'verdict',
            'type': 'uint8'
          },
          {
            'name': 'flags',
            'type': 'uint16'
          },
          {
            'name': 'codeSize',
            'type': 'uint32'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'inspectDelegate',
    'inputs': [
      {
        'name': 'target',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': 'r',
        'type': 'tuple',
        'components': [
          {
            'name': 'kind',
            'type': 'uint8'
          },
          {
            'name': 'delegate',
            'type': 'address'
          },
          {
            'name': 'verdict',
            'type': 'uint8'
          },
          {
            'name': 'flags',
            'type': 'uint16'
          },
          {
            'name': 'codeSize',
            'type': 'uint32'
          }
        ]
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'isKnown',
    'inputs': [
      {
        'name': '',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'isSweeper',
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      }
    ],
    'outputs': [
      {
        'name': '',
        'type': 'bool'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'knownDelegates',
    'inputs': [],
    'outputs': [
      {
        'name': '',
        'type': 'address[]'
      }
    ],
    'stateMutability': 'view'
  },
  {
    'type': 'function',
    'name': 'requireSafeAccount',
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      },
      {
        'name': 'strict',
        'type': 'bool'
      }
    ],
    'outputs': [],
    'stateMutability': 'view'
  },
  {
    'type': 'error',
    'name': 'DelegatedToSweeper',
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      },
      {
        'name': 'delegate',
        'type': 'address'
      }
    ]
  },
  {
    'type': 'error',
    'name': 'DelegatedToUnknown',
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      },
      {
        'name': 'delegate',
        'type': 'address'
      }
    ]
  },
  {
    'type': 'error',
    'name': 'ZeroDelegate',
    'inputs': []
  }
] as const;

/** keccak256 = 0x36e715acc872de22fb3cc3f52d208fe3a43480d60759c11a774406c5c23ef25f */
export const CI_GUARD_BYTECODE: Hex =
  '0x6101a03461017057601f610e8c38819003918201601f19168301916001600160401b038311848410176101745780849261012094604052833981010312610170578051906001600160a01b038216820361017057602081015160ff81168103610170576040820151606083015160808401519061007e60a08601610188565b9261008b60c08701610188565b9461010061009b60e08901610188565b9701519760805260a05260c05260e0526101005261012052610140526101605261018052604051610cf6908161019682396080518181816101b80152818161038e0152610845015260a0518181816102b301526108f7015260c05181818161032a0152610924015260e05181818160b4015261095001526101005181818161023b015261097c0152610120518181816102ee015281816108ab0152610af801526101405181818161014401526109a201526101605181818161027501526109cd0152610180518181816101800152610a5f0152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b519081151582036101705756fe60806040526004361015610011575f80fd5b5f3560e01c80630c13e9921461034d578063252cf2d21461031357806333c4da9f146102d75780633d3aaa9a1461029a5780633f9550d91461025e5780636f51230c146102245780637f7bfaaa146101e75780638fdb5561146101a3578063941411f114610169578063a44813641461012d578063c07cab70146100db5763eaf591441461009d575f80fd5b346100d7575f3660031901126100d75760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346100d7576100fe6100ec36610544565b926100f8929192610721565b506107e2565b9115610117576102a08261011560405180926105be565bf35b60ff90636c68e2dd60e01b5f521660045260245ffd5b346100d7575f3660031901126100d75760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b346100d7575f3660031901126100d75760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100d7575f3660031901126100d7576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346100d7576102e060ff61011561020961020036610544565b929190916107e2565b919390604051941515855216602084015260408301906105be565b346100d7575f3660031901126100d75760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100d7575f3660031901126100d75760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b346100d7575f3660031901126100d757602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b346100d7575f3660031901126100d75760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b346100d7575f3660031901126100d75760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100d75761037161035e36610544565b9161036a949394610721565b50846107e2565b929115610117575060405163167d790d60e21b81526020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156104b4575f91610501575b50604051631b1ef66f60e01b815290602090829060049082906001600160a01b03165afa9081156104b4575f916104bf575b506001600160a01b03168015159182610437575b5050610423576102a09061011560405180926105be565b636c68e2dd60e01b5f52600a60045260245ffd5b60405163d66383cb60e01b81526001600160a01b0390911660048201529150602090829060249082905f905af19081156104b4575f9161047a575b50828061040c565b90506020813d6020116104ac575b81610495602093836106fe565b810103126100d7576104a6906107b8565b82610472565b3d9150610488565b6040513d5f823e3d90fd5b90506020813d6020116104f9575b816104da602093836106fe565b810103126100d757516001600160a01b03811681036100d757836103f8565b3d91506104cd565b90506020813d60201161053c575b8161051c602093836106fe565b810103126100d757516001600160a01b03811681036100d75760206103c6565b3d915061050f565b9060606003198301126100d7576004356001600160a01b03811681036100d757916024356001600160a01b03811681036100d757916044356001600160401b0381116100d757826023820112156100d7576004810135926001600160401b0384116100d75760248460051b830101116100d7576024019190565b610280809160ff815116845260208101511515602085015260ff604082015116604085015260608101511515606085015260808101511515608085015260a0810151151560a085015260ff60c08201511660c085015260ff60e08201511660e085015260ff6101008201511661010085015261012081015115156101208501526101408101516101408501526101608101516101608501526101808101516101808501526101a08101516101a085015261ffff6101c0820151166101c085015260ff6101e0820151166101e085015261ffff6102008201511661020085015261022081015161022085015260ff6102408201511661024085015260ff610260820151166102608501520151910152565b6102a081019081106001600160401b038211176106ea57604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b038211908210176106ea57604052565b6040519061072e826106ce565b5f610280838281528260208201528260408201528260608201528260808201528260a08201528260c08201528260e08201528261010082015282610120820152826101408201528261016082015282610180820152826101a0820152826101c0820152826101e0820152826102008201528261022082015282610240820152826102608201520152565b519081151582036100d757565b519060ff821682036100d757565b519061ffff821682036100d757565b929190916107ee610721565b5060405163713343ed60e01b81526001600160a01b039485166004820152939092166024840152606060448401526064830182905282916084830191905f905b808210610cb457506102a0939283900391508290507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa9081156104b4575f91610b27575b50806020810151151580610ac2575b610aba5750600260ff82511614610ab257600160ff82511614610aaa577f000000000000000000000000000000000000000000000000000000000000000080610a9c575b610a945760ff8151161580610a84575b80610a56575b610a4e5760ff6101e08201511660ff7f00000000000000000000000000000000000000000000000000000000000000001610610a46576101408101517f000000000000000000000000000000000000000000000000000000000000000011610a3e576101608101517f000000000000000000000000000000000000000000000000000000000000000010610a36576101808101517f000000000000000000000000000000000000000000000000000000000000000010610a2e577f000000000000000000000000000000000000000000000000000000000000000080610a20575b610a18577f000000000000000000000000000000000000000000000000000000000000000080610a06575b6109fe576001915f9190565b5f91600b9190565b506101006102008201511615156109f2565b5f9160099190565b5061012081015115156109c7565b5f9160089190565b5f9160079190565b5f9160069190565b5f9160059190565b5f91600c9190565b506102808101517f0000000000000000000000000000000000000000000000000000000000000000116108e6565b5060ff61024082015116156108e0565b5f9160039190565b50600360ff825116146108d0565b5f9160029190565b5f9160019190565b5f9260049250565b5060ff60408201511660018114908115610b1c575b8115610ae4575b5061088c565b600391501480610af5575b5f610ade565b507f0000000000000000000000000000000000000000000000000000000000000000610aef565b600281149150610ad7565b90506102a0813d8211610cac575b81610b436102a093836106fe565b810103126100d75761028060405191610b5b836106ce565b610b64816107c5565b8352610b72602082016107b8565b6020840152610b83604082016107c5565b6040840152610b94606082016107b8565b6060840152610ba5608082016107b8565b6080840152610bb660a082016107b8565b60a0840152610bc760c082016107c5565b60c0840152610bd860e082016107c5565b60e0840152610bea61010082016107c5565b610100840152610bfd61012082016107b8565b6101208401526101408101516101408401526101608101516101608401526101808101516101808401526101a08101516101a0840152610c406101c082016107d3565b6101c0840152610c536101e082016107c5565b6101e0840152610c6661020082016107d3565b610200840152610220810151610220840152610c8561024082016107c5565b610240840152610c9861026082016107c5565b61026084015201516102808201525f61087d565b3d9150610b35565b919350918335906001600160a01b03821682036100d75760208091600193848060a01b0316815201940192018493929161082e56fea164736f6c634300081c000a';
