import '@testing-library/jest-dom/vitest'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.test', quiet: true })
