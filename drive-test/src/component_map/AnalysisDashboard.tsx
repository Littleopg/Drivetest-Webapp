import React, { useState } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Line,
} from 'recharts'

interface Metric {
  Type: string
  'MAE (dB)': number
  'RMSE (dB)': number
}

interface PlotPoint {
  x: number
  y: number
}

interface PlotItem {
  scatter: PlotPoint[]
  line?: PlotPoint[]
}

interface AnalysisDashboardProps {
  metrics: Metric[]
  plotData: Record<string, PlotItem>
  plotData_cell: Record<string, PlotItem>
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({
  metrics,
  plotData,
  plotData_cell,
}) => {
  // Dropdown keys
  const plotKeysFreq = plotData ? Object.keys(plotData) : []
  const [selectedPlotFreq, setSelectedPlotFreq] = useState<string | null>(
    plotKeysFreq[0] || null
  )

  const plotKeysCell = plotData_cell ? Object.keys(plotData_cell) : []
  const [selectedPlotCell, setSelectedPlotCell] = useState<string | null>(
    plotKeysCell[0] || null
  )

  // Hide dashboard if no data
  if (!metrics || (!plotKeysFreq.length && !plotKeysCell.length)) {
    return null
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">
        Path Loss Analysis Results
      </h2>

      {/* 1. Metrics Table */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-600 mb-2">
          SPM Model Metrics
        </h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Analysis Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">
                  MAE (dB)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">
                  RMSE (dB)
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {metrics.map((metric, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {metric.Type}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {metric['MAE (dB)'].toFixed(3)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {metric['RMSE (dB)'].toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Per Frequency Plot */}
      {selectedPlotFreq && plotData[selectedPlotFreq] && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-600 mb-2">
            Path Loss vs. Distance (Per Frequency)
          </h3>

          <select
            value={selectedPlotFreq}
            onChange={(e) => setSelectedPlotFreq(e.target.value)}
            className="mb-4 w-full rounded-md bg-gray-200/20 py-1.5 px-3"
          >
            {plotKeysFreq.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>

          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis
                  type="number"
                  dataKey="x"
                  unit="m"
                  label={{ value: 'Distance (m)', position: 'bottom' }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  unit="dB"
                  label={{ value: 'Path Loss (dB)', position: 'top', offset: 20 }}
                  domain={[0, 'dataMax + 10']}
                />
                <Tooltip />
                <Legend 
                verticalAlign="top" 
                align="right" 
                height={36}
              />

                <Scatter
                  name="Measured PL"
                  data={plotData[selectedPlotFreq].scatter}
                  fill="#8884d8"
                  opacity={0.5}
                />

                {plotData[selectedPlotFreq].line && (
                  <Line
                    type="monotone"
                    dataKey="y"
                    data={plotData[selectedPlotFreq].line}
                    name="SPM PL"
                    stroke="#e60000"
                    dot={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 3. Per Cell Plot */}
      {selectedPlotCell && plotData_cell[selectedPlotCell] && (
        <div>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">
            Path Loss vs. Distance (Per Cell)
          </h3>

          <select
            value={selectedPlotCell}
            onChange={(e) => setSelectedPlotCell(e.target.value)}
            className="mb-4 w-full rounded-md bg-gray-200/20 py-1.5 px-3"
          >
            {plotKeysCell.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>

          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="x" unit="m" label={{ value: 'Distance (m)', position: 'bottom' }} />
                <YAxis type="number" dataKey="y" unit="dB" label={{ value: 'Path Loss (dB)', position: 'top', offset: 25 }} />
                <Tooltip />
                <Legend 
                verticalAlign="top" 
                align="right" 
                height={36}
              />

                <Scatter
                  name="Measured PL"
                  data={plotData_cell[selectedPlotCell].scatter}
                  fill="#82ca9d"
                  opacity={0.5}
                />

                {plotData_cell[selectedPlotCell].line && (
                  <Line
                    type="monotone"
                    dataKey="y"
                    data={plotData_cell[selectedPlotCell].line}
                    name="SPM PL"
                    stroke="#e60000"
                    dot={false}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalysisDashboard
