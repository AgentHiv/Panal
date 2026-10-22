/**
 * cik — el modelo de IA que vive en Monad (contratos `Ci`, `CiView`, `CiRisk`), y
 * `CiGuardV2`, la capa de política que cada protocolo despliega con sus umbrales.
 *
 * Direcciones de la v1.1 (22 de octubre de 2026), código verificado en Sourcify. La
 * v1.0 del 21 de octubre sigue en la cadena, pero no sigue los proxies EIP-1167: con
 * ella $PANAL salía «drainer». No usarla.
 *
 * `CiGuardV2` no está desplegado: cada protocolo despliega el suyo. La página lo
 * EJECUTA sin desplegarlo (un `eth_call` con el bytecode de creación), así que lo que
 * ve quien prueba una política es el contrato de verdad, no una imitación en
 * TypeScript. El bytecode sale del repositorio de cik (commit af1a95d, solc 0.8.28,
 * via-ir, optimizer 1 run, sin hash de metadatos); su keccak256 va abajo para poder
 * comprobarlo.
 *
 * ABIs recortadas a lo que usa la web, generadas de los artefactos compilados.
 * `check` y `evidenceOf` de `Ci` NO son view —la sonda hace un préstamo que
 * siempre revierte— pero no cambian estado: aquí se declaran view para leerlas
 * con `readContract` por `eth_call`, que es como se usan.
 */

import type { Address, Hex } from 'viem';

export const CIK = {
  ci: '0xB05864AAC3Bf7b5D8aB1285CA742fb82b4fF1379' as Address,
  view: '0x69a799D557ca0bA010C76404289BaB68923d3293' as Address,
  risk: '0x9554d12D5A38CC3D6d60220662Cb1bBEAa346a77' as Address,
  models: '0x6E1660395CC9024eF1A0A51c2e7A0499399E045c' as Address,
  probe: '0x70c9F91242ca79706E271e7e7d404f47195681ea' as Address,
  clones: '0x9c66d530ba8C9ED042ED526b75a624440e7f6ACc' as Address,
  symbols: '0x4C19b3e2dc556191b9ACaC53C5cef3C5147D9B12' as Address,
} as const;

/** Lo que se ve en Sourcify: el código fuente de cada contrato con su bytecode. */
export const SOURCIFY = (a: Address) => `https://repo.sourcify.dev/143/${a}`;

export const ciAbi = [
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

/** keccak256 = 0x055608d95257c3b38c7c2f78e53008af07f19d67b79651496555c8f92dbaea92 */
export const CI_GUARD_BYTECODE: Hex =
  '0x6101603461013257601f610cb038819003918201601f19168301916001600160401b038311848410176101365780849260e094604052833981010312610132578051906001600160a01b038216820361013257602081015160ff8116810361013257604082015160608301519060808401519261008a60c061008360a0880161014a565b960161014a565b9560805260a05260c05260e052610100526101205261014052604051610b589081610158823960805181818161016801528181610302015261077a015260a0518181816102270152610816015260c05181818161029e0152610843015260e051818181609e015261086f0152610100518181816101eb015261089b015261012051818181610262015281816107e0015261098c01526101405181818161012e01526108c10152f35b5f80fd5b634e487b7160e01b5f52604160045260245ffd5b519081151582036101325756fe60806040526004361015610011575f80fd5b5f3560e01c80630c13e992146102c1578063252cf2d21461028757806333c4da9f1461024b5780633d3aaa9a1461020e5780636f51230c146101d45780637f7bfaaa146101975780638fdb556114610153578063a448136414610117578063c07cab70146100c55763eaf5914414610087575f80fd5b346100c1575f3660031901126100c15760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b5f80fd5b346100c1576100e86100d6366104b8565b926100e292919261066b565b50610717565b911561010157610240826100ff6040518092610532565bf35b60ff90636c68e2dd60e01b5f521660045260245ffd5b346100c1575f3660031901126100c15760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b346100c1575f3660031901126100c1576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b346100c15761028060ff6100ff6101b96101b0366104b8565b92919091610717565b91939060405194151585521660208401526040830190610532565b346100c1575f3660031901126100c15760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100c1575f3660031901126100c157602060405160ff7f0000000000000000000000000000000000000000000000000000000000000000168152f35b346100c1575f3660031901126100c15760206040517f000000000000000000000000000000000000000000000000000000000000000015158152f35b346100c1575f3660031901126100c15760206040517f00000000000000000000000000000000000000000000000000000000000000008152f35b346100c1576102e56102d2366104b8565b916102de94939461066b565b5084610717565b929115610101575060405163167d790d60e21b81526020816004817f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610428575f91610475575b50604051631b1ef66f60e01b815290602090829060049082906001600160a01b03165afa908115610428575f91610433575b506001600160a01b031680151591826103ab575b505061039757610240906100ff6040518092610532565b636c68e2dd60e01b5f52600a60045260245ffd5b60405163d66383cb60e01b81526001600160a01b0390911660048201529150602090829060249082905f905af1908115610428575f916103ee575b508280610380565b90506020813d602011610420575b8161040960209383610648565b810103126100c15761041a906106ed565b826103e6565b3d91506103fc565b6040513d5f823e3d90fd5b90506020813d60201161046d575b8161044e60209383610648565b810103126100c157516001600160a01b03811681036100c1578361036c565b3d9150610441565b90506020813d6020116104b0575b8161049060209383610648565b810103126100c157516001600160a01b03811681036100c157602061033a565b3d9150610483565b9060606003198301126100c1576004356001600160a01b03811681036100c157916024356001600160a01b03811681036100c157916044356001600160401b0381116100c157826023820112156100c1576004810135926001600160401b0384116100c15760248460051b830101116100c1576024019190565b610220809160ff815116845260208101511515602085015260ff604082015116604085015260608101511515606085015260808101511515608085015260a0810151151560a085015260ff60c08201511660c085015260ff60e08201511660e085015260ff6101008201511661010085015261012081015115156101208501526101408101516101408501526101608101516101608501526101808101516101808501526101a08101516101a085015261ffff6101c0820151166101c085015260ff6101e0820151166101e085015261ffff610200820151166102008501520151910152565b61024081019081106001600160401b0382111761063457604052565b634e487b7160e01b5f52604160045260245ffd5b601f909101601f19168101906001600160401b0382119082101761063457604052565b6040519061067882610618565b5f610220838281528260208201528260408201528260608201528260808201528260a08201528260c08201528260e08201528261010082015282610120820152826101408201528261016082015282610180820152826101a0820152826101c0820152826101e0820152826102008201520152565b519081151582036100c157565b519060ff821682036100c157565b519061ffff821682036100c157565b9291909161072361066b565b5060405163713343ed60e01b81526001600160a01b039485166004820152939092166024840152606060448401526064830182905282916084830191905f905b808210610b165750610240939283900391508290507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03165afa908115610428575f916109bb575b50806020810151151580610956575b61094e5750600260ff8251161461094657600160ff8251161461093e577f000000000000000000000000000000000000000000000000000000000000000080610930575b6109285760ff6101e08201511660ff7f00000000000000000000000000000000000000000000000000000000000000001610610920576101408101517f000000000000000000000000000000000000000000000000000000000000000011610918576101608101517f000000000000000000000000000000000000000000000000000000000000000010610910576101808101517f000000000000000000000000000000000000000000000000000000000000000010610908577f0000000000000000000000000000000000000000000000000000000000000000806108fa575b6108f2576001915f9190565b5f9160099190565b5061012081015115156108e6565b5f9160089190565b5f9160079190565b5f9160069190565b5f9160059190565b5f9160039190565b50600360ff82511614610805565b5f9160029190565b5f9160019190565b5f9260049250565b5060ff604082015116600181149081156109b0575b8115610978575b506107c1565b600391501480610989575b5f610972565b507f0000000000000000000000000000000000000000000000000000000000000000610983565b60028114915061096b565b9050610240813d8211610b0e575b816109d76102409383610648565b810103126100c157610220604051916109ef83610618565b6109f8816106fa565b8352610a06602082016106ed565b6020840152610a17604082016106fa565b6040840152610a28606082016106ed565b6060840152610a39608082016106ed565b6080840152610a4a60a082016106ed565b60a0840152610a5b60c082016106fa565b60c0840152610a6c60e082016106fa565b60e0840152610a7e61010082016106fa565b610100840152610a9161012082016106ed565b6101208401526101408101516101408401526101608101516101608401526101808101516101808401526101a08101516101a0840152610ad46101c08201610708565b6101c0840152610ae76101e082016106fa565b6101e0840152610afa6102008201610708565b61020084015201516102208201525f6107b2565b3d91506109c9565b919350918335906001600160a01b03821682036100c15760208091600193848060a01b0316815201940192018493929161076356fea164736f6c634300081c000a';
