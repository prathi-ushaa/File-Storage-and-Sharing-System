import java.util.*;
import org.cloudbus.cloudsim.*;
import org.cloudbus.cloudsim.core.CloudSim;
import org.cloudbus.cloudsim.provisioners.*;

/**
 * Upload-rush simulation for the file storage system (CloudSim 3.0.3).
 * Each transfer is a cloudlet whose length and file sizes follow the file size:
 *   60% small (1 MB), 30% medium (10 MB), 10% large (25 MB).
 * All users start transferring together; we compare VM counts and scheduling policies.
 */
public class DriveSimulation {

    static final int MI_PER_MB = 200;             // processing work per MB handled
    static final double VM_MIPS = 1000;
    static final double COST_PER_VM_SEC = 0.0001; // illustrative rate

    public static void main(String[] args) throws Exception {
        int[] userCounts = {100, 500, 1000};
        int[] vmCounts = {2, 5, 10};
        String[] policies = {"TimeShared", "SpaceShared"};

        System.out.printf("%-8s %-5s %-12s %-14s %-12s %-10s%n",
                "Users", "VMs", "Scheduler", "AvgResp(s)", "Makespan(s)", "Cost");
        for (int n : userCounts)
            for (int vms : vmCounts)
                for (String p : policies)
                    run(n, vms, p);
    }

    static int pickSizeMb(Random rnd) {
        double r = rnd.nextDouble();
        return r < 0.6 ? 1 : (r < 0.9 ? 10 : 25);
    }

    static void run(int users, int vmCount, String policy) throws Exception {
        Log.disable();
        CloudSim.init(1, Calendar.getInstance(), false);

        Datacenter dc = createDatacenter("DriveDC");
        DatacenterBroker broker = new DatacenterBroker("Broker");
        int brokerId = broker.getId();

        List<Vm> vms = new ArrayList<>();
        for (int i = 0; i < vmCount; i++) {
            CloudletScheduler cs = policy.equals("TimeShared")
                    ? new CloudletSchedulerTimeShared() : new CloudletSchedulerSpaceShared();
            vms.add(new Vm(i, brokerId, VM_MIPS, 1, 2048, 10000, 10000, "Xen", cs));
        }

        Random rnd = new Random(42); // fixed seed so every run uses the same workload
        UtilizationModel full = new UtilizationModelFull();
        List<Cloudlet> cloudlets = new ArrayList<>();
        for (int i = 0; i < users; i++) {
            int mb = pickSizeMb(rnd);
            long bytes = mb * 1024L * 1024L;
            Cloudlet c = new Cloudlet(i, (long) mb * MI_PER_MB, 1, bytes, bytes, full, full, full);
            c.setUserId(brokerId);
            cloudlets.add(c);
        }

        broker.submitVmList(vms);
        broker.submitCloudletList(cloudlets);
        CloudSim.startSimulation();
        List<Cloudlet> done = broker.getCloudletReceivedList();
        CloudSim.stopSimulation();

        double sum = 0, max = 0;
        int ok = 0;
        for (Cloudlet c : done) {
            if (c.getStatus() == Cloudlet.SUCCESS) {
                sum += c.getFinishTime();
                max = Math.max(max, c.getFinishTime());
                ok++;
            }
        }
        System.out.printf("%-8d %-5d %-12s %-14.2f %-12.2f %-10.4f%n",
                users, vmCount, policy, ok == 0 ? 0 : sum / ok, max, vmCount * max * COST_PER_VM_SEC);
    }

    static Datacenter createDatacenter(String name) throws Exception {
        List<Host> hosts = new ArrayList<>();
        for (int h = 0; h < 4; h++) {
            List<Pe> pes = new ArrayList<>();
            for (int p = 0; p < 8; p++) pes.add(new Pe(p, new PeProvisionerSimple(2000)));
            hosts.add(new Host(h, new RamProvisionerSimple(32768), new BwProvisionerSimple(1000000),
                    10000000, pes, new VmSchedulerTimeShared(pes)));
        }
        DatacenterCharacteristics ch = new DatacenterCharacteristics(
                "x86", "Linux", "Xen", hosts, 5.5, 3.0, 0.05, 0.001, 0.0);
        return new Datacenter(name, ch, new VmAllocationPolicySimple(hosts),
                new LinkedList<Storage>(), 0);
    }
}
