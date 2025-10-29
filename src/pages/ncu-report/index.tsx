import { Box, Container, Paper, Typography } from '@mui/material';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '../../components/PageHeader';
import { useDataFromSource } from '../../hooks/useDataFromSource';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import Plot from 'react-plotly.js';

interface NCUReportData {
  ID: string;
  Kernel_Name: string;
  Time: string;
  Memory_Bandwidth: string;
  SMSP_Instructions: string;
  Cycles: string;
  TFLOPS: string;
}

const columns: GridColDef[] = [
  { field: 'ID', headerName: 'Kernel ID', width: 120 },
  { field: 'Kernel_Name', headerName: 'Kernel Name', width: 400 },
  {
    field: 'Time',
    headerName: 'Time (s)',
    width: 150,
    valueFormatter: (value: string) => {
      const n = parseFloat(value.replace(/,/g, ''));
      // If value isn't numeric, show NaN s (since checks removed)
      return n.toFixed(3) + ' s';
    }
  },
  {
    field: 'Memory_Bandwidth',
    headerName: 'DRAM Bandwidth (TB/s)',
    width: 250,
    valueFormatter: (value: string) => {
      return value + ' TB/s';
    }
  },
  {
    field: 'SMSP_Instructions',
    headerName: 'Tensor Instr/Cycle',
    width: 180,
    valueFormatter: (value: string) => {
      const n = parseFloat(value.replace(/,/g, ''));
      if (Number.isNaN(n)) return '0.00';
      return n.toFixed(2);
    }
  },
  {
    field: 'Cycles',
    headerName: 'Cycles',
    width: 150
  },
  {
    field: 'TFLOPS',
    headerName: 'TFLOPS',
    width: 150,
    valueFormatter: (value: string) => {
      const n = parseFloat(value.replace(/,/g, ''));
      if (Number.isNaN(n)) return '0.00';
      return n.toFixed(2) + ' TFLOPS';
    }
  },
];

function NCUReport() {
  // Load the NCU report data
  const reportData = useDataFromSource('data/ncu_report_raw.csv') || [];

  // Transform and filter the data to show only memory bandwidth metrics
  const transformedData = reportData.reduce((acc: NCUReportData[], row: any) => {
    const raw = row['dram__bytes.sum.per_second'];
    if (raw === undefined || raw === null) return acc;
    const cleaned = String(raw).replace(/,/g, '').trim();
    const numeric = parseFloat(cleaned);
    // If not numeric (units row, header, or blank), skip the row
    if (Number.isNaN(numeric)) return acc;
    const parsed = numeric;
    const timeRaw = row['gpu__time_duration.avg'];
    const smspRaw = row['smsp__inst_executed_pipe_tensor.sum.per_cycle_elapsed'];
    const cyclesRaw = row['gpc__cycles_elapsed.sum'];
    const timeStr = String(timeRaw || '0').replace(/,/g, '').trim();
    const smspStr = String(smspRaw || '0').replace(/,/g, '').trim();
    const cyclesStr = String(cyclesRaw || '0').replace(/,/g, '').trim();
    const timeNum = parseFloat(timeStr);
    const smspNum = parseFloat(smspStr);
    const cyclesNum = parseFloat(cyclesStr);
    const tf = (smspNum * cyclesNum / Math.max(timeNum, 0.001)) * 64e-12;
    acc.push({
      ID: String(row['ID'] || 'Unknown'),
      Kernel_Name: String(row['Kernel Name'] || 'Unknown Kernel'),
      Time: timeStr,
      Memory_Bandwidth: parsed.toString(),
      SMSP_Instructions: smspStr,
      Cycles: cyclesStr,
      TFLOPS: tf.toString()
    });
    return acc;
  }, []);

  // Roofline model data - using A100 double precision compute limits
  // A100 peak DP (CUDA cores) TFLOPS ~19.5, peak bandwidth ~1555 GB/s = 1.555 TB/s
  // Note: Tensor cores do not natively support FP64 operations in A100
  const peakCompute = 19.5; // TFLOPS
  const peakMem = 1.555; // TB/s
  const aiKnee = peakCompute / peakMem;
  const maxAI = Math.max(aiKnee * 10, 1);
  const aiRoof = Array.from({ length: 100 }, (_, i) => (maxAI / 99) * i + 0.0001);
  const perfRoof = aiRoof.map(ai => Math.min(ai * peakMem, peakCompute));
  const kernelAI = transformedData.map((r: NCUReportData) => {
    const tf = parseFloat(r.TFLOPS || '0');
    const bw = parseFloat(r.Memory_Bandwidth || '0');
    return tf / Math.max(bw, 0.01);
  });
  const kernelPerf = transformedData.map((r: NCUReportData) => parseFloat(r.TFLOPS || '0'));
  const kernelNames = transformedData.map((r: NCUReportData) => r.Kernel_Name);

  // Roofline insights
  const validKernels = kernelAI.filter((ai: number, i: number) => !isNaN(ai) && !isNaN(kernelPerf[i]));
  const memoryBound = validKernels.filter((ai: number) => ai < aiKnee).length;
  const computeBound = validKernels.filter((ai: number) => ai >= aiKnee).length;
  const avgAI = validKernels.length > 0 ? validKernels.reduce((sum: number, ai: number) => sum + ai, 0) / validKernels.length : 0;
  const avgPerformance = validKernels.length > 0
    ? kernelPerf.filter((_val: number, i: number) => !isNaN(kernelAI[i]) && !isNaN(kernelPerf[i]))
      .reduce((sum: number, p: number) => sum + p, 0) / validKernels.length : 0;
  const memoryBoundPct = memoryBound / validKernels.length * 100;
  const computeBoundPct = computeBound / validKernels.length * 100;
  const maxAIIndex = kernelAI.findIndex((ai: number, i: number) => !isNaN(ai) && !isNaN(kernelPerf[i]) && ai === Math.max(...validKernels));
  const maxPerfIndex = kernelPerf.findIndex((p: number, i: number) => !isNaN(kernelPerf[i]) && !isNaN(kernelAI[i]) && p === Math.max(...kernelPerf.filter((_val: number, idx: number) => !isNaN(kernelAI[idx]) && !isNaN(kernelPerf[idx]))));
  const maxAIKernel = maxAIIndex >= 0 ? transformedData[maxAIIndex]?.Kernel_Name : 'N/A';
  const maxPerfKernel = maxPerfIndex >= 0 ? transformedData[maxPerfIndex]?.Kernel_Name : 'N/A';

  return (
    <Container maxWidth={false}>
      <PageHeader
        pageTitle="NCU Report UI"
        title="NCU Report UI"
        description="NVIDIA NSight Compute GPU Kernel Analysis"
      />
      <Paper sx={{ padding: 2, marginBottom: 2 }}>
        <Typography variant="h6" gutterBottom>
          Kernel Performance Metrics
        </Typography>
        <Box sx={{ height: 400 }}>
          <DataGrid
            rows={transformedData}
            columns={columns}
            getRowId={(row: NCUReportData) => row.ID}
            pageSizeOptions={[10, 25, 50]}
          />
        </Box>
      </Paper>
      <Paper sx={{ padding: 2, marginBottom: 2 }}>
        <Typography variant="h6" gutterBottom>
          Metrics Description
        </Typography>
        <Typography gutterBottom>
          - Kernel ID: Unique identifier for each GPU kernel.
        </Typography>
        <Typography gutterBottom>
          - Kernel Name: The name of the kernel function being profiled.
        </Typography>
        <Typography gutterBottom>
          - Time (s): Average execution time of the kernel in seconds.
        </Typography>
        <Typography gutterBottom>
          - DRAM Bandwidth (TB/s): Measured DRAM memory bandwidth utilization in terabytes per second during kernel execution.
        </Typography>
        <Typography gutterBottom>
          - Tensor Instr/Cycle: Average number of tensor pipeline instructions executed per elapsed cycle by SMSP (Streaming Multiprocessor Sub-Partition).
        </Typography>
        <Typography gutterBottom>
          - Cycles: Total number of GPU cycles elapsed during kernel execution.
        </Typography>
        <Typography gutterBottom>
          - TFLOPS: Estimated double-precision Tensor FLOP performance in Terraflops per second, calculated from tensor instructions per cycle, cycles elapsed, and time.
        </Typography>
      </Paper>
      <Paper sx={{ padding: 2, marginBottom: 2 }}>
        <Typography variant="h6" gutterBottom>
          Roofline Model Plot
        </Typography>
        <Plot
          data={[
            {
              x: aiRoof,
              y: perfRoof,
              type: 'scatter',
              mode: 'lines',
              name: 'Roofline'
            },
            {
              x: kernelAI.filter((_val: number, i: number) => !isNaN(kernelAI[i]) && !isNaN(kernelPerf[i])),
              y: kernelPerf.filter((_val: number, i: number) => !isNaN(kernelAI[i]) && !isNaN(kernelPerf[i])),
              type: 'scatter',
              mode: 'markers',
              text: kernelNames.filter((_val: string, i: number) => !isNaN(kernelAI[i]) && !isNaN(kernelPerf[i])),
              name: 'Kernels'
            }
          ]}
          layout={{
            title: 'Roofline Model (A100 Double Precision)',
            xaxis: { type: 'log', title: 'Arithmetic Intensity (FLOPs/byte)' },
            yaxis: { type: 'log', title: 'Performance (TFLOPS)' },
            height: 500
          }}
          style={{ width: '100%' }}
        />
      </Paper>
      <Paper sx={{ padding: 2, marginBottom: 2 }}>
        <Typography variant="h6" gutterBottom>
          Roofline Insights
        </Typography>
        <Typography gutterBottom>
          Total kernels analyzed: {transformedData.length}
        </Typography>
        <Typography gutterBottom>
          {`Memory-bound kernels (AI < ${aiKnee.toFixed(2)} FLOPs/byte): ${memoryBound} (${memoryBoundPct.toFixed(1)}%)`}
        </Typography>
        <Typography gutterBottom>
          {`Compute-bound kernels (AI >= ${aiKnee.toFixed(2)} FLOPs/byte): ${computeBound} (${computeBoundPct.toFixed(1)}%)`}
        </Typography>
        <Typography gutterBottom>
          Average arithmetic intensity: {avgAI.toFixed(4)} FLOPs/byte
        </Typography>
        <Typography gutterBottom>
          Average performance: {avgPerformance.toFixed(2)} TFLOPS
        </Typography>
        <Typography gutterBottom>
          Highest arithmetic intensity kernel: {maxAIKernel}
        </Typography>
        <Typography gutterBottom>
          Highest performance kernel: {maxPerfKernel}
        </Typography>
        <Typography gutterBottom>
          Roofline peak compute: {peakCompute} TFLOPS, peak memory bandwidth: {peakMem} TB/s
        </Typography>
        <Typography gutterBottom>
          Note: A100 Tensor cores do not natively support FP64 operations; performance reflects CUDA core capabilities.
        </Typography>
      </Paper>
      <Paper sx={{ padding: 2, marginBottom: 2 }}>
        <Typography variant="h6" gutterBottom>
          Optimization Recommendations
        </Typography>
        {memoryBound > computeBound ? (
          <>
            <Typography gutterBottom>
              <strong>Memory-Bound Optimization Focus:</strong> Most kernels are memory-bound. Focus on improving memory access efficiency.
            </Typography>
            <Typography gutterBottom>
              - Increase data reuse: Restructure algorithms to maximize data locality and reuse data in registers/cache before spilling to global memory.
            </Typography>
            <Typography gutterBottom>
              - Optimize cache utilization: Use shared memory for frequently accessed data, consider cooperative groups for better cache sharing.
            </Typography>
            <Typography gutterBottom>
              - Reduce global memory transactions: Fuse kernels where possible, use vectorized loads (float4/int4), and minimize scattered memory access patterns.
            </Typography>
            <Typography gutterBottom>
              - Consider algorithmic changes: Explore cache-friendly representations like blocked algorithms for matrix operations.
            </Typography>
          </>
        ) : (
          <>
            <Typography gutterBottom>
              <strong>Compute-Bound Optimization Focus:</strong> Most kernels are compute-bound. Focus on maximizing computational throughput.
            </Typography>
            <Typography gutterBottom>
              - Increase parallelism: Ensure enough concurrent threads to saturate the compute units, adjust block sizes if needed.
            </Typography>
            <Typography gutterBottom>
              - Optimize instruction selection: Prefer instructions with higher throughput, avoid divergent control flow.
            </Typography>
            <Typography gutterBottom>
              - Load balancing: Distribute work evenly across SMs to avoid tail effects in parallel reduction operations.
            </Typography>
            <Typography gutterBottom>
              - Consider precision requirements: If FP64 precision isn't required, consider using TF32 for higher throughput.
            </Typography>
          </>
        )}
        <Typography gutterBottom>
          <strong>General Recommendations:</strong>
        </Typography>
        <Typography gutterBottom>
          - Profile outliers: Focus optimization efforts on kernels with highest TFLOPS or those farthest from the roofline.
        </Typography>
        <Typography gutterBottom>
          - Balance workloads: For memory-bound kernels near the knee, data access improvements may provide better ROI than compute optimizations.
        </Typography>
        <Typography gutterBottom>
          - Re-profile after changes: Use roofline model to validate optimization impact and prioritize next iterations.
        </Typography>
      </Paper>
    </Container>
  );
}

export const Route = createFileRoute('/ncu-report/')({
  component: NCUReport
});
